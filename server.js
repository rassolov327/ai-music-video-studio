// AI Music Video Studio — server
// Serves the app (like Caddy did before) and proxies paid image generation to KIE.ai.
//
// Architecture (rebuilt after research — see project history):
//   - Uses KIE's UNIFIED job API (POST /api/v1/jobs/createTask, GET /api/v1/jobs/recordInfo)
//     instead of a model-specific endpoint. This is what KIE's own docs actually recommend,
//     and it's what makes "pick a model from a list" trivial — model is just a string.
//   - Webhook-first: every task is created with a callBackUrl pointing back at this server.
//     KIE's docs explicitly say polling their status endpoint can lag behind the real
//     result — confirmed on this project (a task showed "still generating" via polling
//     3.5 minutes after KIE's own dashboard showed it complete). The webhook is the fix.
//   - Polling is kept ONLY as a fallback safety net in case a webhook delivery is missed
//     (their own docs note occasional webhook reliability issues too) — not as the
//     primary mechanism anymore.
//   - An in-memory task store powers both the webhook handler and the Tasks tab. It resets
//     if the server restarts/redeploys — acceptable for now since tasks finish in minutes,
//     but worth remembering if Railway restarts mid-generation.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

const KIE_API_KEY = process.env.KIE_API_KEY || '';
const KIE_BASE = 'https://api.kie.ai';
// Free-tier text helper (tags, prompt polish, script breakdown) — separate provider, kept
// intentionally simple/free rather than routed through KIE, since it's a different kind of
// job (text, not paid image/video generation).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.6-flash'; // Google retires these fast — if this 404s again, check ai.google.dev/gemini-api/docs/models for the current GA Flash model and update just this line
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Railway sets this automatically; needed to build a callBackUrl KIE can reach.
const PUBLIC_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  : (process.env.PUBLIC_URL || '');

app.use(express.json({ limit: '20mb' }));

// Same CSP shape the project already relied on (Caddyfile), with blob: explicitly present
// in img-src and media-src — omitting it silently breaks restored photos/audio with no
// console error, which cost a lot of debugging time earlier in this project.
app.use((req, res, next) => {
  // Cross-origin isolation — ffmpeg.wasm's newer SDK versions appear to silently hang inside
  // ffmpeg.load() without this, even when using the single-threaded core that in principle
  // shouldn't need it. credentialless (not the stricter require-corp) is used deliberately —
  // require-corp would block any cross-origin resource that doesn't explicitly send a CORP
  // header, which would break loading KIE-hosted images before they're persisted locally.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https: blob: 'unsafe-inline' 'wasm-unsafe-eval'",
      "worker-src 'self' blob: https:",
      "style-src 'self' https: 'unsafe-inline'",
      "font-src 'self' https: data:",
      "img-src 'self' data: blob: https: *",
      "media-src 'self' data: blob: https: *",
      "connect-src 'self' https: blob:",
    ].join('; ')
  );
  next();
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// ============================================================
// In-memory task store — powers both the webhook handler and the Tasks tab.
// { taskId: { status: 'pending'|'success'|'failed', imageUrl, message, model,
//             meta: { projectId, sceneId, sceneName, shotId, shotName },
//             createdAt, updatedAt } }
// ============================================================
const tasks = new Map();
const TASK_RETENTION_MS = 2 * 60 * 60 * 1000; // keep finished tasks around for 2 hours

function pruneOldTasks() {
  const cutoff = Date.now() - TASK_RETENTION_MS;
  for (const [id, t] of tasks) {
    if (t.status !== 'pending' && t.updatedAt < cutoff) tasks.delete(id);
  }
}
setInterval(pruneOldTasks, 10 * 60 * 1000).unref();

// ---- health check ----
app.get('/api/health', (req, res) => {
  res.json({ ok: true, kieConfigured: !!KIE_API_KEY, publicUrlConfigured: !!PUBLIC_URL, geminiConfigured: !!GEMINI_API_KEY });
});

// ---- image download proxy ----
// Used when the browser needs to download a generated image (from KIE's temp hosting or
// Pollinations) to save it as a real local asset. A direct browser fetch() of a
// cross-origin image can be silently blocked depending on that host's CORS headers, which
// we have no control over and can't guarantee — routing through our own same-origin server
// sidesteps that entirely, since server-to-server requests aren't subject to CORS.
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'bad_request', message: 'A valid url query param is required.' });
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'provider_error', message: 'Could not fetch the image (HTTP ' + upstream.status + ').' });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('[server] /api/proxy-image failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- free text helper (Gemini) — tags, prompt polish, script breakdown, etc. ----
// Deliberately generic: the client sends a ready-made instruction + the raw text to work
// from, and gets back plain text. Keeping this generic (rather than one endpoint per
// feature) means new AI-assist buttons in the UI don't need new server routes.
app.post('/api/assist/text', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on the server yet.' });
  }
  const { instruction, input, history } = req.body || {};
  const hasHistory = Array.isArray(history) && history.length > 0;
  if (!hasHistory && (!instruction || typeof instruction !== 'string')) {
    return res.status(400).json({ error: 'bad_request', message: 'instruction is required.' });
  }
  // First turn: instruction (system framing) + input combine into one message. Follow-up
  // turns (history present): the framing was already established, so just send the raw
  // input as the newest turn, appended after the prior exchanges.
  const promptText = instruction ? (input ? (instruction + '\n\n---\n\n' + input) : instruction) : (input || '');
  const contents = hasHistory
    ? [...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: promptText }] }]
    : [{ role: 'user', parts: [{ text: promptText }] }];
  try {
    const geminiRes = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    });
    const data = await geminiRes.json().catch(() => null);
    if (!geminiRes.ok) {
      console.warn('[server] Gemini request failed:', JSON.stringify(data));
      return res.status(502).json({ error: 'provider_error', message: (data && data.error && data.error.message) || ('Gemini rejected the request (HTTP ' + geminiRes.status + ').') });
    }
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) {
      console.warn('[server] Gemini returned no usable text:', JSON.stringify(data));
      return res.status(502).json({ error: 'provider_error', message: 'Gemini returned an empty response — it may have been blocked by a safety filter.' });
    }
    res.json({ text: text.trim() });
  } catch (err) {
    console.error('[server] /api/assist/text failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- known models — the client's "choose a model" list reads from this ----
// Verified against docs.kie.ai's own published request examples for each model. Only
// listing ones with a plain {prompt, aspect_ratio-ish} input shape — anything needing
// image inputs (image-to-image variants) doesn't fit "generate a shot from a prompt" yet.
const MODELS = [
  { id: 'z-image', label: 'Z-Image (fastest, cheapest)', supportsAspectRatio: true, costUsd: 0.01 },
  { id: 'gpt-image/1.5-text-to-image', label: 'GPT-Image 1.5', supportsAspectRatio: true, supportsQuality: true, costUsd: 0.03 },
  { id: 'qwen2/text-to-image', label: 'Qwen2', supportsImageSize: true, costUsd: 0.02 },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', supportsAspectRatio: true, supportsResolution: true, supportsReferenceImage: true, costUsd: 0.04 },
  { id: 'nano-banana-2', label: 'Nano Banana 2', supportsAspectRatio: true, supportsResolution: true, supportsReferenceImage: true, costUsd: 0.06 },
  { id: 'ideogram/character', label: 'Ideogram Character', supportsReferenceImage: true, referenceImageField: 'reference_image_urls', costUsd: 0.06 },
  { id: 'gpt-image-2-text-to-image', label: 'GPT Image 2', supportsAspectRatio: true, supportsReferenceImage: true, costUsd: 0.04, imageToImageId: 'gpt-image-2-image-to-image', referenceImageField: 'input_urls' },
  // Model id inferred from Seedream 5.0 Lite's confirmed naming pattern (seedream/5-lite-*)
  // — docs.kie.ai's own model list confirms a Pro text-to-image and image-to-image pair
  // exist, but no literal request example for Pro specifically was found to copy exactly.
  // maxPromptLength: KIE's own validation for this model family enforces a hard character
  // cap — confirmed 3000 for the Lite tier's docs; Pro isn't separately confirmed but is
  // assumed to share it, since a real generation hit "text length cannot exceed the
  // maximum limit" with our normal shot-prompt length (character/location context easily
  // pushes past 3000 chars, unlike our other models which don't enforce this).
  { id: 'seedream/5-pro-text-to-image', label: 'Seedream 5.0 Pro', supportsAspectRatio: true, supportsReferenceImage: true, costUsd: 0.06, imageToImageId: 'seedream/5-pro-image-to-image', referenceImageField: 'image_urls', maxPromptLength: 2900 },
];
// ---- Script tab: breaks a pasted script into a structured scenes/characters/locations/
// props/looks proposal. Uses Gemini's own JSON response mode (responseMimeType +
// responseSchema) rather than just asking nicely in the prompt — far more reliable than
// hoping the model's free-text output happens to be valid, parseable JSON.
app.post('/api/assist/analyze-script', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on the server yet.' });
  }
  const { scriptText, existingCharacterNames, shotSizes, cameraMoves, songDurationSec } = req.body || {};
  if (!scriptText || typeof scriptText !== 'string' || !scriptText.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'scriptText is required.' });
  }
  const sizesList = Array.isArray(shotSizes) && shotSizes.length ? shotSizes : ['Wide Shot', 'Medium Shot', 'Close-Up'];
  const movesList = Array.isArray(cameraMoves) && cameraMoves.length ? cameraMoves : ['Static', 'Push In', 'Pull Out'];
  const knownNames = Array.isArray(existingCharacterNames) ? existingCharacterNames : [];

  const instruction = [
    'You are a film/music-video director\'s assistant. Break the following script into a structured production breakdown.',
    'Group the action into scenes (a scene = one location + one continuous span of time), and within each scene propose a shot list — individual camera shots that would actually film that scene\'s action, each with a concrete visual description, a shotSize, and a cameraMove.',
    'shotSize must be exactly one of: ' + sizesList.join(', ') + '.',
    'cameraMove must be exactly one of: ' + movesList.join(', ') + '.',
    knownNames.length ? ('These characters already exist in the project — reuse their exact names if the script refers to them: ' + knownNames.join(', ') + '.') : '',
    songDurationSec ? ('There is a song on the timeline, ' + songDurationSec + ' seconds long — keep the total number of shots reasonable for that length, but do not force scenes to align to any particular song structure.') : '',
    'Only include a "looks" entry for a character if the script actually describes specific clothing/outfit — do not invent one. Every character/location/prop/look needs a short name and a short visual description suitable as an image-generation prompt.',
    'Write every name and description in the SAME language as the script text itself (e.g. a Russian script gets Russian names/descriptions, an English script gets English ones) — never translate, always match the script\'s own language.',
    'Respond with ONLY the JSON breakdown, nothing else.',
  ].filter(Boolean).join('\n');

  const responseSchema = {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            location: { type: 'string' },
            timeOfDay: { type: 'string' },
            characters: { type: 'array', items: { type: 'string' } },
            props: { type: 'array', items: { type: 'string' } },
            shots: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  shotSize: { type: 'string' },
                  cameraMove: { type: 'string' },
                },
                required: ['description', 'shotSize', 'cameraMove'],
              },
            },
          },
          required: ['name', 'location', 'shots'],
        },
      },
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, role: { type: 'string' }, description: { type: 'string' } },
          required: ['name', 'description'],
        },
      },
      locations: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, description: { type: 'string' } },
          required: ['name', 'description'],
        },
      },
      props: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, description: { type: 'string' } },
          required: ['name', 'description'],
        },
      },
      looks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, characterName: { type: 'string' }, description: { type: 'string' } },
          required: ['name', 'characterName', 'description'],
        },
      },
    },
    required: ['scenes', 'characters', 'locations', 'props', 'looks'],
  };

  try {
    const geminiRes = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction + '\n\n---SCRIPT---\n\n' + scriptText }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
    });
    const data = await geminiRes.json().catch(() => null);
    if (!geminiRes.ok) {
      console.warn('[server] Gemini script-analysis request failed:', JSON.stringify(data));
      return res.status(502).json({ error: 'provider_error', message: (data && data.error && data.error.message) || ('Gemini rejected the request (HTTP ' + geminiRes.status + ').') });
    }
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) {
      console.warn('[server] Gemini returned no usable text for script analysis:', JSON.stringify(data));
      return res.status(502).json({ error: 'provider_error', message: 'Gemini returned an empty response — it may have been blocked by a safety filter.' });
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) {
      console.warn('[server] Gemini script-analysis output was not valid JSON:', text.slice(0, 500));
      return res.status(502).json({ error: 'provider_error', message: 'Gemini returned something that was not valid JSON.' });
    }
    res.json({ proposal: parsed });
  } catch (err) {
    console.error('[server] /api/assist/analyze-script failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

app.get('/api/models', (req, res) => {
  // Costs are our best estimate from KIE's own published credit pricing ($0.005/credit) —
  // shown to the user as an approximation, not an invoice.
  res.json({ models: MODELS.map(m => ({ id: m.id, label: m.label, costUsd: m.costUsd, supportsReferenceImage: !!m.supportsReferenceImage })) });
});

// ---- video models (image-to-video, for animating an already-generated shot) ----
// All three are the same Kling v2.1 family, verified against docs.kie.ai's own request
// examples — same input shape (prompt, image_url, duration, negative_prompt, cfg_scale)
// across all three tiers, just different quality/price points.
const VIDEO_MODELS = [
  { id: 'kling/v2-1-standard', label: 'Kling 2.1 Standard', costUsd: 0.125, blurb: '720p — fastest and cheapest, solid everyday motion' },
  { id: 'kling/v2-1-pro', label: 'Kling 2.1 Pro', costUsd: 0.25, blurb: '1080p — smoother, more realistic motion' },
  { id: 'kling/v2-1-master-image-to-video', label: 'Kling 2.1 Master', costUsd: 0.80, blurb: '1080p — best quality, realistic physics and camera work, priciest' },
  // Confirmed via docs.kie.ai's own request example for this exact model id: Seedance uses
  // first_frame_url (and, only when animating between two chosen images, last_frame_url
  // too) even for plain single-image animation — NOT the image_url field Kling uses. A
  // first real single-image (non-2-frame) generation sent image_url here, which Seedance
  // didn't recognize, silently generated with no visual anchor at all, and produced a
  // completely different character/location — this flag is what fixed it.
  // Video-model pricing on KIE actually scales with duration/resolution, not a flat
  // per-generation fee — a real 5s generation billed 165 credits ($0.825) against our
  // earlier flat $0.30 guess, a 2.75x miss. Recalibrated from that real bill rather than
  // another guess; still an estimate (shown as "≈"), KIE's own dashboard is the real total.
  { id: 'bytedance/seedance-2-fast', label: 'Seedance 2.0 Fast', costUsd: 0.80, blurb: 'Supports first+last frame — animates a clean transition between two chosen images', supportsLastFrame: true, imageFieldName: 'first_frame_url' },
  // Confirmed via a literal docs.kie.ai request example (model id "bytedance/seedance-2",
  // same first_frame_url/last_frame_url convention as Fast) — the full/standard tier: up to
  // 4K, stronger multi-shot consistency, ~5min vs Fast's ~4min. costUsd is an unconfirmed
  // guess (no real bill yet, unlike Fast's recalibrated figure above) — flagged the same
  // way every other unverified cost estimate has been; correct it against KIE's dashboard
  // once a real generation runs. Deliberately NOT wiring the extra multi-reference/native
  // audio inputs this pass (reference_image_urls/reference_video_urls/reference_audio_urls/
  // generate_audio) — those are a bigger, separate feature to design later, not a drop-in.
  { id: 'bytedance/seedance-2', label: 'Seedance 2.0', costUsd: 1.10, blurb: 'Full/standard tier — stronger multi-shot consistency, up to 4K, for a final polished pass rather than quick drafts', supportsLastFrame: true, imageFieldName: 'first_frame_url' },
];
app.get('/api/video-models', (req, res) => {
  res.json({ models: VIDEO_MODELS.map(m => ({ id: m.id, label: m.label, costUsd: m.costUsd, blurb: m.blurb, supportsLastFrame: !!m.supportsLastFrame })) });
});

// ---- lip-sync models — separate list since these take video+audio, not prompt+image ----
// Field names (video_url, audio_url, mode, separate_vocal, etc.) confirmed directly from
// KIE's own interactive playground page for this model — an earlier version of this had
// guessed reseller-style names (source_video_url/enable_vocal_separation) that KIE
// rejected with "field is required" on the first real attempt; fixed once the playground's
// own field schema was found. The model id itself is still a best inference (matches the
// URL-slug convention every other multi-word KIE model page follows, e.g. "Kling-3.0
// motion-control" -> "kling-3.0/motion-control") since no createTask id was shown on that
// same page — if this alone were wrong, the error would likely read "model not found"
// rather than "field is required", so the id is probably fine, but not 100% confirmed yet.
const LIPSYNC_MODELS = [
  { id: 'volcengine/video-to-video-lip-sync', label: 'Volcengine Video-to-Video Lip Sync (Lite)', costUsd: 0.20, blurb: 'Syncs mouth movement to any audio, with built-in vocal separation for singing over a full music mix', volcMode: 'lite' },
  { id: 'volcengine/video-to-video-lip-sync-basic', label: 'Volcengine Video-to-Video Lip Sync (Basic)', costUsd: 0.20, blurb: 'Same model, advanced mode — adds scene/speaker detection, worth trying if Lite quality disappoints', volcMode: 'basic' },
];
app.get('/api/lipsync-models', (req, res) => {
  res.json({ models: LIPSYNC_MODELS.map(m => ({ id: m.id, label: m.label, costUsd: m.costUsd, blurb: m.blurb })) });
});
app.post('/api/lipsync/start', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { videoUrl, audioUrl, model, meta } = req.body || {};
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'videoUrl and audioUrl are both required.' });
  }
  const matched = LIPSYNC_MODELS.find(m => m.id === model) || LIPSYNC_MODELS[0];
  // Both entries are really the same KIE model id — "Basic" is just a different mode value
  // in the request, not a different model — so the real id sent to KIE is always the base one.
  const modelId = 'volcengine/video-to-video-lip-sync';
  const input = {
    video_url: videoUrl,
    audio_url: audioUrl,
    mode: matched.volcMode || 'lite',
    separate_vocal: true, // isolates the singer's voice from the instrumental mix before syncing
  };
  const callBackUrl = PUBLIC_URL ? PUBLIC_URL + '/api/webhook/kie' : undefined;

  try {
    const body = { model: modelId, input };
    if (callBackUrl) body.callBackUrl = callBackUrl;
    const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json().catch(() => null);
    console.log('[server] create lip-sync task (' + modelId + '):', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    tasks.set(taskId, {
      status: 'pending', imageUrl: null, message: null, model: matched.id, prompt: '', isVideo: true,
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(),
    });
    if (!callBackUrl) {
      console.warn('[server] no PUBLIC_URL known — this task will rely entirely on the polling fallback.');
    }
    return res.json({ taskId });
  } catch (err) {
    console.error('[server] /api/lipsync/start failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- photo -> singing-performance models (image + song audio -> one finished video) ----
// Confirmed directly from KIE's own full docs navigation sidebar (docs.kie.ai) — OmniHuman
// is its own top-level category, not nested under Bytedance like Seedance is, so its id has
// no provider prefix at all: docs.kie.ai/market/omnihuman-1-5 -> model id "omnihuman-1-5".
// Two earlier guesses (bytedance/omnihuman-v1-5, then bytedance/omnihuman-1-5) both wrongly
// assumed a bytedance/ prefix by analogy with Seedance — this is now a real, confirmed id,
// not another inference. Kling AI Avatar's id (kling/ai-avatar-standard) was independently
// confirmed correct too from the same navigation — that one's earlier failure was purely
// the missing prompt field, already fixed, not a wrong model id.
const PHOTO_LIPSYNC_MODELS = [
  { id: 'omnihuman-1-5', label: 'OmniHuman 1.5', costUsd: 0.80, blurb: 'Built specifically for singing — captures musical phrasing and pauses, not just phoneme-level lip sync', provider: 'omnihuman' },
  { id: 'kling/ai-avatar-standard', label: 'Kling AI Avatar (Standard)', costUsd: 0.45, blurb: 'Cheaper alternative — independent side-by-side tests rated it behind OmniHuman for singing specifically, but it is faster and less costly', provider: 'kling-avatar' },
];
app.get('/api/photo-lipsync-models', (req, res) => {
  res.json({ models: PHOTO_LIPSYNC_MODELS.map(m => ({ id: m.id, label: m.label, costUsd: m.costUsd, blurb: m.blurb })) });
});
app.post('/api/photo-lipsync/start', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { imageUrl, audioUrl, model, meta } = req.body || {};
  if (!imageUrl || !audioUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'imageUrl and audioUrl are both required.' });
  }
  const matched = PHOTO_LIPSYNC_MODELS.find(m => m.id === model) || PHOTO_LIPSYNC_MODELS[0];
  const input = matched.provider === 'omnihuman'
    ? { image_url: imageUrl, audio_url: audioUrl, output_resolution: '1080' }
    : { image_url: imageUrl, audio_url: audioUrl, prompt: 'The person sings passionately along with the audio, with facial expressions and movement matching the rhythm and emotion of the song.' };
  const callBackUrl = PUBLIC_URL ? PUBLIC_URL + '/api/webhook/kie' : undefined;

  try {
    const body = { model: matched.id, input };
    if (callBackUrl) body.callBackUrl = callBackUrl;
    const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json().catch(() => null);
    console.log('[server] create photo-lipsync task (' + matched.id + '):', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    tasks.set(taskId, {
      status: 'pending', imageUrl: null, message: null, model: matched.id, prompt: '', isVideo: true,
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(),
    });
    if (!callBackUrl) {
      console.warn('[server] no PUBLIC_URL known — this task will rely entirely on the polling fallback.');
    }
    return res.json({ taskId });
  } catch (err) {
    console.error('[server] /api/photo-lipsync/start failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- KIE.ai credit balance (for the small indicator in the corner of the UI) ----
const KIE_CREDIT_USD = 0.005; // KIE's own published rate — see docs.kie.ai
app.get('/api/kie-credits', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  try {
    const creditRes = await fetch(`${KIE_BASE}/api/v1/chat/credit`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    const data = await creditRes.json().catch(() => null);
    if (!creditRes.ok || !data || typeof data.data !== 'number') {
      return res.status(502).json({ error: 'provider_error', message: (data && data.msg) || ('KIE.ai rejected the request (HTTP ' + creditRes.status + ').') });
    }
    const credits = data.data;
    const cheapestModel = MODELS.reduce((min, m) => (m.costUsd && (!min || m.costUsd < min.costUsd)) ? m : min, null);
    const usd = credits * KIE_CREDIT_USD;
    const imagesRemaining = cheapestModel ? Math.floor(usd / cheapestModel.costUsd) : null;
    res.json({ credits, usd, imagesRemaining });
  } catch (err) {
    console.error('[server] /api/kie-credits failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

function closestAspectRatio(width, height) {
  const ratio = (width && height) ? width / height : 16 / 9;
  const options = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'];
  const asNum = (s) => { const [a, b] = s.split(':').map(Number); return a / b; };
  let best = options[0], bestDiff = Infinity;
  for (const o of options) {
    const diff = Math.abs(Math.log(ratio) - Math.log(asNum(o)));
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  }
  return best;
}

function buildInputFor(modelId, prompt, width, height, referenceImageUrl) {
  const model = MODELS.find(m => m.id === modelId) || MODELS[0];
  const ratio = closestAspectRatio(width, height);
  let safePrompt = prompt;
  if (model.maxPromptLength && safePrompt && safePrompt.length > model.maxPromptLength) {
    console.warn('[server] prompt too long for ' + modelId + ' (' + safePrompt.length + ' chars) — truncating to ' + model.maxPromptLength);
    safePrompt = safePrompt.slice(0, model.maxPromptLength - 3) + '...';
  }
  const input = { prompt: safePrompt };
  if (model.supportsImageSize) input.image_size = ratio;
  else if (model.supportsAspectRatio) input.aspect_ratio = ratio;
  if (model.supportsQuality) input.quality = 'high';
  if (model.supportsResolution) input.resolution = '2K';
  let actualModelId = modelId;
  if (model.supportsReferenceImage && referenceImageUrl) {
    const urls = Array.isArray(referenceImageUrl) ? referenceImageUrl.filter(Boolean) : [referenceImageUrl];
    const field = model.referenceImageField || 'image_input';
    // gpt-image-2 has no single "reference or not" switch on one model id — using a
    // reference means sending the request to its separate image-to-image model entirely.
    if (model.imageToImageId) {
      actualModelId = model.imageToImageId;
      input[field] = urls;
    } else {
      input[field] = urls;
    }
  }
  return { modelId: actualModelId, input };
}

// ---- reference image upload — for generating a location/prop from a real photo of it ----
// In-memory only (same lifetime as the task store): the browser can't hand KIE a local
// blob/data: URL, only a fetchable link, so we hold the photo here just long enough for
// KIE to pull it during generation.
const referenceImages = new Map(); // id -> { buffer, mime, createdAt }
function pruneOldReferenceImages(){
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour is plenty — generation finishes in minutes
  for(const [id, img] of referenceImages){ if(img.createdAt < cutoff) referenceImages.delete(id); }
}
setInterval(pruneOldReferenceImages, 15 * 60 * 1000).unref();

app.post('/api/upload-reference-image', (req, res) => {
  if(!PUBLIC_URL){
    return res.status(503).json({ error: 'not_configured', message: 'No public URL detected for this deployment — KIE can\'t fetch a reference image without one.' });
  }
  const { dataUrl } = req.body || {};
  if(!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf('data:')!==0){
    return res.status(400).json({ error: 'bad_request', message: 'dataUrl is required.' });
  }
  try{
    const commaIdx = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, commaIdx);
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const buffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
    const id = 'ref_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    referenceImages.set(id, { buffer, mime, createdAt: Date.now() });
    res.json({ url: PUBLIC_URL + '/api/reference-image/' + id });
  } catch(err){
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});
app.get('/api/reference-image/:id', (req, res) => {
  const img = referenceImages.get(req.params.id);
  if(!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.send(img.buffer);
});

// ---- start a generation task ----
// `meta` carries scene/shot context purely for display in the Tasks tab — it never goes
// to KIE, it's just stored alongside the task on our side.
app.post('/api/generate-image/start', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { prompt, width, height, model, meta, referenceImageUrl } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'prompt is required.' });
  }
  const modelId = (MODELS.find(m => m.id === model) || MODELS[0]).id;
  const built = buildInputFor(modelId, prompt, width, height, referenceImageUrl);
  const actualModelId = built.modelId;
  const input = built.input;
  const callBackUrl = PUBLIC_URL ? PUBLIC_URL + '/api/webhook/kie' : undefined;

  try {
    const body = { model: actualModelId, input };
    if (callBackUrl) body.callBackUrl = callBackUrl;
    const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json().catch(() => null);
    console.log('[server] create task (' + modelId + '):', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    tasks.set(taskId, {
      status: 'pending', imageUrl: null, message: null, model: actualModelId, prompt,
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(),
    });
    if (!callBackUrl) {
      console.warn('[server] no PUBLIC_URL known — this task will rely entirely on the polling fallback.');
    }
    return res.json({ taskId });
  } catch (err) {
    console.error('[server] /api/generate-image/start failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- video generation (image-to-video, animates an already-generated shot) ----
// Reuses the exact same task store, webhook, and status-check machinery as image
// generation above — applyTaskResult just extracts whatever URL comes back, regardless of
// whether it's an image or a video, so nothing there needed to change.
function buildVideoInputFor(modelId, imageUrl, prompt, duration, lastFrameImageUrl) {
  const model = VIDEO_MODELS.find(m => m.id === modelId);
  if (model && model.imageFieldName === 'first_frame_url') {
    const input = { prompt, first_frame_url: imageUrl, duration: String(duration || 5) };
    if (lastFrameImageUrl) input.last_frame_url = lastFrameImageUrl;
    return input;
  }
  return {
    prompt,
    image_url: imageUrl,
    duration: String(duration || 5),
    negative_prompt: 'blurry, distorted, low quality, extra limbs, morphing, flickering',
    cfg_scale: 0.5,
  };
}
app.post('/api/generate-video/start', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { prompt, imageUrl, lastFrameImageUrl, duration, model, meta } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'prompt is required.' });
  }
  if (!imageUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'imageUrl is required — video generation animates an already-generated shot image.' });
  }
  const modelId = (VIDEO_MODELS.find(m => m.id === model) || VIDEO_MODELS[0]).id;
  const input = buildVideoInputFor(modelId, imageUrl, prompt, duration, lastFrameImageUrl);
  const callBackUrl = PUBLIC_URL ? PUBLIC_URL + '/api/webhook/kie' : undefined;

  try {
    const body = { model: modelId, input };
    if (callBackUrl) body.callBackUrl = callBackUrl;
    const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json().catch(() => null);
    console.log('[server] create video task (' + modelId + '):', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    tasks.set(taskId, {
      status: 'pending', imageUrl: null, message: null, model: modelId, prompt, isVideo: true, duration: duration || 5,
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(),
    });
    if (!callBackUrl) {
      console.warn('[server] no PUBLIC_URL known — this task will rely entirely on the polling fallback.');
    }
    return res.json({ taskId });
  } catch (err) {
    console.error('[server] /api/generate-video/start failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- webhook — KIE calls this the moment a task actually finishes ----
// The exact payload shape isn't confirmed from docs alone (only the request side, i.e.
// callBackUrl usage, was documented) — log the raw body in full so the first real delivery
// can be inspected, and parse defensively across the shapes KIE uses elsewhere.
app.post('/api/webhook/kie', (req, res) => {
  const body = req.body || {};
  console.log('[server] webhook received:', JSON.stringify(body));
  const d = body.data || body;
  const taskId = d.taskId || body.taskId;
  if (!taskId) {
    console.warn('[server] webhook payload had no recognizable taskId — ignoring.');
    return res.status(200).json({ ok: true }); // still 200 so KIE doesn't retry forever
  }
  applyTaskResult(taskId, d);
  res.status(200).json({ ok: true });
});

function extractResultUrl(d) {
  if (!d) return null;
  if (d.resultJson) {
    try {
      const parsed = JSON.parse(d.resultJson);
      if (parsed.resultUrls && parsed.resultUrls[0]) return parsed.resultUrls[0];
      if (parsed.result_urls && parsed.result_urls[0]) return parsed.result_urls[0];
    } catch (err) { /* fall through */ }
  }
  if (d.response) {
    if (d.response.resultUrls && d.response.resultUrls[0]) return d.response.resultUrls[0];
    if (d.response.result_urls && d.response.result_urls[0]) return d.response.result_urls[0];
  }
  if (d.resultUrls && d.resultUrls[0]) return d.resultUrls[0];
  return null;
}

function applyTaskResult(taskId, d) {
  const existing = tasks.get(taskId) || { meta: {}, createdAt: Date.now() };
  const state = (d.state || '').toLowerCase();
  const flag = Number(d.successFlag);
  const isSuccess = state === 'success' || flag === 1;
  const isFailed = state === 'fail' || state === 'failed' || flag === 2 || !!d.failMsg || !!d.errorMessage;
  const resultUrl = extractResultUrl(d);

  if (isSuccess && resultUrl) {
    tasks.set(taskId, { ...existing, status: 'success', imageUrl: resultUrl, updatedAt: Date.now() });
    console.log('[server] task ' + taskId + ' -> success');
  } else if (isFailed) {
    tasks.set(taskId, { ...existing, status: 'failed', message: d.failMsg || d.errorMessage || 'Generation failed.', updatedAt: Date.now() });
    console.log('[server] task ' + taskId + ' -> failed:', d.failMsg || d.errorMessage);
  } else {
    tasks.set(taskId, { ...existing, status: 'pending', updatedAt: Date.now() });
  }
}

// ---- status check — reads our own fast in-memory store first (kept fresh by the webhook).
// Only reaches out to KIE directly as a fallback if we have no record yet, or the record
// is getting old without a webhook ever arriving (delivery can occasionally fail). ----
app.get('/api/generate-image/status', async (req, res) => {
  const taskId = req.query.taskId;
  if (!taskId) return res.status(400).json({ error: 'bad_request', message: 'taskId is required.' });

  let t = tasks.get(taskId);
  const staleMs = t ? Date.now() - t.updatedAt : Infinity;
  const shouldFallbackPoll = !t || (t.status === 'pending' && staleMs > 20000);

  if (shouldFallbackPoll && KIE_API_KEY) {
    try {
      const pollRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      });
      const pollData = await pollRes.json().catch(() => null);
      console.log('[server] fallback poll ' + taskId + ':', JSON.stringify(pollData));
      if (pollData && pollData.data) applyTaskResult(taskId, pollData.data);
      t = tasks.get(taskId);
    } catch (err) {
      console.warn('[server] fallback poll failed:', err);
    }
  }

  if (!t) return res.json({ status: 'pending', taskId });
  if (t.status === 'success') return res.json({ status: 'success', imageUrl: t.imageUrl, taskId });
  if (t.status === 'failed') return res.json({ status: 'failed', message: t.message, taskId });
  return res.json({ status: 'pending', taskId });
});

// ---- list tasks for the Tasks tab, optionally filtered by project ----
app.get('/api/tasks', (req, res) => {
  const projectId = req.query.projectId;
  const out = [];
  for (const [taskId, t] of tasks) {
    if (projectId && t.meta && t.meta.projectId && t.meta.projectId !== projectId) continue;
    out.push({ taskId, ...t });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ tasks: out });
});

// ---- remove a task from tracking (doesn't cancel it on KIE's side, just stops us
// showing/watching it) ----
app.delete('/api/tasks/:taskId', (req, res) => {
  tasks.delete(req.params.taskId);
  res.json({ ok: true });
});

// ---- diagnostic: raw, unmodified KIE response for a given taskId ----
app.get('/api/debug/task/:taskId', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  try {
    const pollRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(req.params.taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    const text = await pollRes.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(pollRes.status).send(text);
  } catch (err) {
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log('AI Music Video Studio server listening on port ' + PORT);
  console.log('KIE_API_KEY configured: ' + (!!KIE_API_KEY));
  console.log('Public URL for webhooks: ' + (PUBLIC_URL || '(none detected — falling back to polling only)'));
});
