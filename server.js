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

app.use(express.json({ limit: '2mb' }));

// Same CSP shape the project already relied on (Caddyfile), with blob: explicitly present
// in img-src and media-src — omitting it silently breaks restored photos/audio with no
// console error, which cost a lot of debugging time earlier in this project.
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https: 'unsafe-inline'",
      "style-src 'self' https: 'unsafe-inline'",
      "font-src 'self' https: data:",
      "img-src 'self' data: blob: https: *",
      "media-src 'self' blob: https: *",
      "connect-src 'self' https:",
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
  const { instruction, input } = req.body || {};
  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'instruction is required.' });
  }
  const promptText = input ? (instruction + '\n\n---\n\n' + input) : instruction;
  try {
    const geminiRes = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptText }] }] }),
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
  { id: 'z-image', label: 'Z-Image (fastest, cheapest)', supportsAspectRatio: true },
  { id: 'gpt-image/1.5-text-to-image', label: 'GPT-Image 1.5', supportsAspectRatio: true, supportsQuality: true },
  { id: 'qwen2/text-to-image', label: 'Qwen2', supportsImageSize: true },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', supportsAspectRatio: true, supportsResolution: true },
];
app.get('/api/models', (req, res) => {
  res.json({ models: MODELS.map(m => ({ id: m.id, label: m.label })) });
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

function buildInputFor(modelId, prompt, width, height) {
  const model = MODELS.find(m => m.id === modelId) || MODELS[0];
  const ratio = closestAspectRatio(width, height);
  const input = { prompt };
  if (model.supportsImageSize) input.image_size = ratio;
  else if (model.supportsAspectRatio) input.aspect_ratio = ratio;
  if (model.supportsQuality) input.quality = 'high';
  if (model.supportsResolution) input.resolution = '2K';
  return input;
}

// ---- start a generation task ----
// `meta` carries scene/shot context purely for display in the Tasks tab — it never goes
// to KIE, it's just stored alongside the task on our side.
app.post('/api/generate-image/start', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { prompt, width, height, model, meta } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'prompt is required.' });
  }
  const modelId = (MODELS.find(m => m.id === model) || MODELS[0]).id;
  const input = buildInputFor(modelId, prompt, width, height);
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
    console.log('[server] create task (' + modelId + '):', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    tasks.set(taskId, {
      status: 'pending', imageUrl: null, message: null, model: modelId,
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
