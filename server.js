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
import { initDb, pool } from './db.js';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
const execFileAsync = promisify(execFile);
// Loaded defensively — this is only needed for one optional step (video faststart remux
// for Motion Control), and a failed/missing install of this package must never be able to
// take down the whole server. If it's unavailable, remuxFaststart below just throws and
// the caller already falls back to using the original, un-remuxed file.
let ffmpegPath = null;
try{
  ffmpegPath = (await import('ffmpeg-static')).default;
} catch(err){
  console.warn('[server] ffmpeg-static not available — video faststart remux will be skipped:', err && err.message);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

const KIE_API_KEY = process.env.KIE_API_KEY || '';
const KIE_BASE = 'https://api.kie.ai';
// Direct ElevenLabs account (Костян's own, real free/paid tier there) — separate from the
// KIE-proxied ElevenLabs path above (kie-elevenlabs-multi), which goes through KIE credits
// instead. Confirmed real request/response shape via docs.elevenlabs.io — synchronous, one
// POST returns the finished audio bytes directly, no createTask+poll needed like KIE's async
// pattern (see tvCallElevenLabsDirectVoice below).
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
// Free-tier text helper (tags, prompt polish, script breakdown) — separate provider, kept
// intentionally simple/free rather than routed through KIE, since it's a different kind of
// job (text, not paid image/video generation).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.6-flash'; // Google retires these fast — if this 404s again, check ai.google.dev/gemini-api/docs/models for the current GA Flash model and update just this line
// gemini-2.5-flash-preview-tts — a real user confirmed this one actually works (a live
// Микрофонная run produced real playable audio), so it stays the default rather than
// getting swapped for the newer name below sight-unseen. Override via env if this 404s.
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
// gemini-3.1-flash-tts-preview — Google's newer native-audio TTS model (confirmed real via
// a docs/pricing search, not guessed), same free tier as everything else on GEMINI_API_KEY.
// KIE.ai separately lists this exact model too (kie.ai/gemini-3.1-flash-tts), but that's a
// paid proxy on top of it — going direct to Google, like GEMINI_TTS_MODEL above already
// does, is the free path, so this is wired as a second free option rather than through KIE.
// Unlike GEMINI_TTS_MODEL, this one hasn't actually been run for real yet.
const GEMINI_TTS_MODEL_NEXT = process.env.GEMINI_TTS_MODEL_NEXT || 'gemini-3.1-flash-tts-preview';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Railway sets this automatically; needed to build a callBackUrl KIE can reach.
const PUBLIC_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  : (process.env.PUBLIC_URL || '');

const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET is not set — using an insecure built-in fallback. Set a real SESSION_SECRET env var before real users log in.');
}

app.use(express.json({ limit: '20mb' }));
app.use(cookieParser(SESSION_SECRET || 'insecure-dev-fallback-change-me'));

// ---- auth (stage 2 of the user/token system) ----
// Deliberately simple for a small, admin-managed user base — one signed httpOnly cookie
// holding just the user's numeric id, no separate session store/table needed at this
// scale. requireAuth is exported-in-place for later stages (protecting generation routes,
// stage 6) to reuse rather than re-deriving this logic.
async function requireAuth(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'not_configured', message: 'The user database is not available.' });
  const userId = req.signedCookies && req.signedCookies.session;
  if (!userId) return res.status(401).json({ error: 'not_authenticated', message: 'Not logged in.' });
  try {
    const result = await pool.query('SELECT id, name, login, tokens, is_admin FROM users WHERE id = $1', [userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'not_authenticated', message: 'Not logged in.' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error('[server] requireAuth query failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not verify login.' });
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'forbidden', message: 'Admin access required.' });
    next();
  });
}

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, login, tokens, is_admin, last_login, created_at FROM users ORDER BY id ASC');
    const users = result.rows;
    // Admin rows show the LIVE KIE balance, not the stored tokens column — this is what
    // makes the number in the table always exactly match reality, since it's fetched
    // fresh rather than being a stored number that could ever drift or get hand-edited.
    if (users.some(u => u.is_admin)) {
      try {
        const liveCredits = await fetchKieCreditsRaw();
        users.forEach(u => { if (u.is_admin) u.tokens = liveCredits; });
      } catch (err) {
        console.warn('[server] could not fetch live KIE balance for admin row(s), showing the stored value instead:', err);
      }
    }
    res.json({ users });
  } catch (err) {
    console.error('[server] /api/admin/users (list) failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not load users.' });
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { name, login, password, tokens } = req.body || {};
  if (!name || !login || !password) {
    return res.status(400).json({ error: 'bad_request', message: 'Name, login, and password are all required.' });
  }
  const tokenCount = Number.isFinite(Number(tokens)) ? Math.max(0, Math.floor(Number(tokens))) : 0;
  try {
    // Hard rule, per Костян: never let the sum of tokens promised to ALL users exceed
    // his real KIE balance — checked fresh against KIE every time, not a cached number.
    if (tokenCount > 0) {
      const [kieCredits, sumResult] = await Promise.all([
        fetchKieCreditsRaw(),
        pool.query("SELECT COALESCE(SUM(tokens), 0) AS total FROM users WHERE is_admin = false"),
      ]);
      const currentTotal = Number(sumResult.rows[0].total);
      if (currentTotal + tokenCount > kieCredits) {
        return res.status(400).json({
          error: 'over_budget',
          message: `Can't add ${tokenCount} tokens — that would put total user tokens (${currentTotal + tokenCount}) over your real KIE balance (${kieCredits}).`,
        });
      }
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, login, password_hash, tokens, is_admin)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, name, login, tokens, is_admin, last_login, created_at`,
      [name, login, hash, tokenCount]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err && err.code === '23505') { // unique_violation on login
      return res.status(400).json({ error: 'login_taken', message: 'That login is already in use.' });
    }
    console.error('[server] /api/admin/users (create) failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not create the user.' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_request', message: 'Invalid user id.' });
  if (id === req.user.id) return res.status(400).json({ error: 'bad_request', message: "You can't delete your own account while logged in as it." });
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] /api/admin/users (delete) failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not delete the user.' });
  }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_request', message: 'Invalid user id.' });
  const { login, password, addTokens } = req.body || {};
  try {
    const current = await pool.query('SELECT id, tokens, is_admin FROM users WHERE id = $1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'not_found', message: 'User not found.' });

    if (current.rows[0].is_admin && Number(addTokens)) {
      return res.status(400).json({
        error: 'admin_tokens_locked',
        message: "An admin account's balance always mirrors your real KIE credits — it can't be edited here. It changes only from generations or topping up on KIE.",
      });
    }

    const sets = [];
    const values = [];
    let i = 1;
    if (login) { sets.push(`login = $${i++}`); values.push(login); }
    if (password) { sets.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }

    const addAmt = Number.isFinite(Number(addTokens)) ? Math.floor(Number(addTokens)) : 0;
    if (addAmt !== 0) {
      // Same hard rule as creating a user, checked fresh — the total across everyone
      // (including this top-up) can never exceed Костян's real KIE balance.
      const [kieCredits, othersResult] = await Promise.all([
        fetchKieCreditsRaw(),
        pool.query('SELECT COALESCE(SUM(tokens), 0) AS total FROM users WHERE id != $1 AND is_admin = false', [id]),
      ]);
      const othersTotal = Number(othersResult.rows[0].total);
      const newTokens = current.rows[0].tokens + addAmt;
      if (newTokens < 0) {
        return res.status(400).json({ error: 'bad_request', message: "Can't remove more tokens than this user has." });
      }
      if (othersTotal + newTokens > kieCredits) {
        return res.status(400).json({
          error: 'over_budget',
          message: `Can't add ${addAmt} tokens — that would put total user tokens (${othersTotal + newTokens}) over your real KIE balance (${kieCredits}).`,
        });
      }
      sets.push(`tokens = $${i++}`); values.push(newTokens);
    }

    if (!sets.length) return res.status(400).json({ error: 'bad_request', message: 'Nothing to update.' });
    values.push(id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, name, login, tokens, is_admin, last_login, created_at`,
      values
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'login_taken', message: 'That login is already in use.' });
    }
    console.error('[server] /api/admin/users (edit) failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not update the user.' });
  }
});


app.post('/api/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'not_configured', message: 'The user database is not available yet.' });
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'bad_request', message: 'Login and password are both required.' });
  }
  try {
    const result = await pool.query('SELECT id, name, login, password_hash, tokens, is_admin FROM users WHERE login = $1', [login]);
    const user = result.rows[0];
    // Same generic message whether the login doesn't exist or the password is wrong —
    // doesn't tell an attacker which one they got right.
    const genericError = { error: 'invalid_credentials', message: 'Incorrect login or password.' };
    if (!user) return res.status(401).json(genericError);
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json(genericError);
    await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
    res.cookie('session', String(user.id), {
      httpOnly: true, signed: true, sameSite: 'lax',
      secure: req.protocol === 'https', maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    res.json({ id: user.id, name: user.name, login: user.login, tokens: user.tokens, isAdmin: user.is_admin });
  } catch (err) {
    console.error('[server] /api/login failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not log in.' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, login: req.user.login, tokens: req.user.tokens, isAdmin: req.user.is_admin });
});

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
      "connect-src 'self' https: blob: data:",
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

// ---- /TV: "Собрать новости" — REAL, sourced IT/games/software/internet news from the
// matching calendar week 25 years ago. No auth/DB needed — /TV persists this
// client-side, this route is stateless. Two real sources, combined, no recall/invention:
//  - Wayback Machine (week-precise): real archived snapshots of real tech-news sites from
//    the exact target week, page text scraped and handed to Gemini with a strict
//    "extract only what's literally present" instruction — this is CLAUDE.md's
//    "Structuring" step, not a search/recall step.
//  - Wikipedia (year-precise, supplementary): real category-listed articles + real page
//    summaries for the target year, same structuring treatment.
// Every returned item carries a real sourceUrl the user can click and verify. If both
// passes come back empty, the response is an empty list — never a silent fallback to
// recalled/invented facts, since replacing exactly that recall behavior is the point.
function tvHistoricalWeekRange(refDate) {
  const now = refDate || new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + ((day === 0 ? -6 : 1) - day));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const histMonday = new Date(monday); histMonday.setUTCFullYear(monday.getUTCFullYear() - 25);
  const histSunday = new Date(sunday); histSunday.setUTCFullYear(sunday.getUTCFullYear() - 25);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(histMonday), end: fmt(histSunday) };
}

// Widens a week-range into a ~30-day window centered on the same midpoint — used only as a
// fallback when a rubric came back with zero real items for the exact target week (see
// /api/tv/gather-news below). Every item pulled from this wider window is honestly tagged
// sourcePrecision:'month' rather than passed off as week-accurate.
function tvMonthRange(range) {
  const start = new Date(range.start + 'T00:00:00Z');
  const end = new Date(range.end + 'T00:00:00Z');
  const midMs = (start.getTime() + end.getTime()) / 2;
  const dayMs = 24 * 60 * 60 * 1000;
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(new Date(midMs - 15 * dayMs)), end: fmt(new Date(midMs + 15 * dayMs)) };
}

function tvStripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Shared "structure this real retrieved text, don't invent" Gemini call — used by both
// passes below. `withSourceIndex` adds a required sourceIndex field so the caller (not
// Gemini) maps each item back to its real URL/date — Gemini never gets to invent a source.
// `job` (optional) gets the real 429 quota error's own "Please retry in Ns" text parsed out
// and logged as a live countdown, then the call retries automatically — Google's free tier
// (20 requests/minute, shared across every Gemini feature in this app) means a burst of
// testing/clicking can genuinely exhaust it; the countdown is real, not a fake animation.
async function tvCallGeminiStructuring(instruction, withSourceIndex, job) {
  const itemProps = {
    rubric: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' },
    // A short ENGLISH search phrase for finding a real illustrative photo afterward — kept
    // separate from `title`/`summary` (which are Russian) since Wikimedia Commons search
    // works far better on English terms.
    imageQuery: { type: 'string' },
  };
  const required = ['rubric', 'title', 'summary', 'imageQuery'];
  if (withSourceIndex) { itemProps.sourceIndex = { type: 'integer' }; required.push('sourceIndex'); }
  const responseSchema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: itemProps, required } } }, required: ['items'] };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    tvCheckAbort(job);
    const geminiRes = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }] }],
        // temperature:0 — this is an EXTRACTION task (pull out what's literally in the given
        // text), not creative writing. Without this, Gemini's default sampling temperature
        // made repeated runs against the identical real source text return different subsets
        // of items with different wording each time — Костян noticed results "didn't seem
        // tied to anything consistent" between gathers. Deterministic extraction of the same
        // real input should give the same real output.
        generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
      }),
      signal: tvAbortSignal(job),
    });
    const data = await geminiRes.json().catch(() => null);
    if (geminiRes.ok) {
      const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) throw new Error('Gemini returned an empty response — it may have been blocked by a safety filter.');
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.items) ? parsed.items : [];
    }
    const message = (data && data.error && data.error.message) || ('Gemini rejected the request (HTTP ' + geminiRes.status + ').');
    const retryMatch = geminiRes.status === 429 && message.match(/retry in ([\d.]+)s/i);
    if (retryMatch && attempt < maxAttempts) {
      const waitSec = Math.ceil(parseFloat(retryMatch[1])) + 1; // +1s safety margin over Google's own estimate
      for (let s = waitSec; s > 0; s--) {
        tvCheckAbort(job);
        tvJobLogCountdown(job, s);
        await new Promise((r) => setTimeout(r, 1000));
      }
      tvJobLog(job, `Gemini: лимит освободился, повторяю запрос (попытка ${attempt + 1} из ${maxAttempts})...`);
      continue;
    }
    throw new Error(message);
  }
  throw new Error('Gemini: не удалось получить ответ после нескольких попыток.');
}

// Real, well-archived tech-news sites from the era — mixed EN + RU on purpose (Костян's
// ask: don't limit sourcing to the Russian-language segment). This list is research-based
// (real outlets that existed and published tech/games/hardware news across our target
// years) but NOT individually confirmed against live Wayback captures — web.archive.org
// isn't reachable from the tooling used to build this, same standing caveat as the rest of
// this file's Wayback code. Expect some entries to yield little/nothing for a given week;
// that's expected and handled per-site (one bad site never blocks the others).
const TV_WAYBACK_SITES = [
  'cnet.com', 'zdnet.com', 'wired.com', 'gamespot.com', 'ign.com', 'theregister.co.uk',
  'arstechnica.com', 'slashdot.org', 'pcworld.com',
  'compulenta.ru', 'ixbt.com', '3dnews.ru', 'overclockers.ru', 'cnews.ru',
];
// Real article pages only — never spend a fetch on a stylesheet/script/feed/sitemap/icon.
const TV_WAYBACK_SKIP_PATH_RE = /\.(css|js|xml|rss|json|png|jpe?g|gif|svg|ico|woff2?|ttf|pdf)(\?|$)|\/(feed|rss|sitemap|robots\.txt|favicon\.ico)(\/|$)/i;

// Returns RAW real records only — no Gemini call here. Every gather source used to make its
// own separate Gemini structuring call (up to 4 per single "Собрать новости" click: Wayback,
// Компьютерра, Wikipedia, plus the opt-in month-fallback), and against the free tier's 20
// requests/minute cap that burned through quota fast, especially across repeated clicks
// while testing ("Quota exceeded... limit: 20... Please retry in 26s" — the exact error
// Костян hit). All real per-source fetching now returns a common raw-record shape
// ({kind, promptLabel, promptText, sourceUrl, sourceDate, sourcePrecision, media, rawTitle})
// so tvStructureRawRecords() below can combine everything into ONE Gemini call per gather.
//
// ---- gather-news job infrastructure (console log + Стоп button, js/tv-app.js) ----
// A single blocking request can't stream progress back mid-flight, so "Собрать новости" now
// starts an in-memory background job (POST .../start), and the client polls its status/log
// (GET .../status/:jobId) — same start+poll shape this codebase already uses for KIE
// createTask+recordInfo. In-memory only (no DB, matches CLAUDE.md's "no Postgres for /TV's
// own data") — a stale-job sweep on every new job keeps this from growing unbounded.
let tvGatherJobSeq = 1;
const tvGatherJobs = new Map();
function tvCreateGatherJob() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, j] of tvGatherJobs) { if (j.createdAt < cutoff) tvGatherJobs.delete(id); }
  const id = String(tvGatherJobSeq++);
  const job = { id, status: 'running', log: [], result: null, aborted: false, abortController: new AbortController(), createdAt: Date.now(), _countdownActive: false };
  tvGatherJobs.set(id, job);
  return job;
}
function tvJobLog(job, text) {
  if (!job) return;
  job._countdownActive = false;
  job.log.push(text);
}
// Ticks update the SAME log line in place instead of spamming one line per second — the
// client just re-renders the current full log array on each poll, so an in-place edit here
// shows up as a live-updating countdown with no special client-side merge logic needed.
function tvJobLogCountdown(job, secondsLeft) {
  if (!job) return;
  const line = `Gemini: лимит запросов исчерпан, жду ${secondsLeft} сек...`;
  if (job._countdownActive) job.log[job.log.length - 1] = line;
  else { job.log.push(line); job._countdownActive = true; }
}
class TvJobAborted extends Error {}
function tvCheckAbort(job) {
  if (job && job.aborted) throw new TvJobAborted('Остановлено пользователем.');
}
// tvCheckAbort alone only catches a stop BETWEEN steps — if a single fetch (Wayback CDX
// against archive.org especially; confirmed slow/hang-prone in testing) is already in
// flight, nothing notices "Стоп" was pressed until that fetch itself finishes. Every fetch
// in the gather pipeline below passes this signal so an abort actually interrupts a stuck
// network call instead of the whole job silently waiting it out.
function tvAbortSignal(job) {
  return job && job.abortController ? job.abortController.signal : undefined;
}

async function tvFetchWaybackRaw(range, job) {
  const from = range.start.replace(/-/g, '');
  const to = range.end.replace(/-/g, '');
  tvJobLog(job, `Wayback Machine: проверяю ${TV_WAYBACK_SITES.length} сайтов за ${range.start} — ${range.end}...`);
  // Sites run in parallel (each independently try/caught, one bad site can't block the
  // rest); pages within a site are fetched sequentially to avoid bursting archive.org with
  // too many concurrent requests from one caller at once.
  const perSite = await Promise.all(TV_WAYBACK_SITES.map(async (site) => {
    try {
      // matchType=domain + collapse=urlkey: the CDX API's DEFAULT match mode is 'exact' —
      // querying the bare domain with no matchType (an earlier version of this code) only
      // ever matches that literal homepage URL, never any article page under it. Confirmed
      // against the CDX server's own docs (github.com/internetarchive/wayback/blob/master/
      // wayback-cdx-server/README.md) — this was the main reason so few real stories came
      // back: Wayback rarely holds more than 1-2 homepage snapshots a week, and a homepage's
      // own text (after stripping nav/ads) rarely reads as real article prose anyway.
      // matchType=domain widens the query to every real URL under the domain (and its
      // subdomains) captured in the target week; collapse=urlkey keeps one snapshot per
      // distinct URL instead of one per timestamp.
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(site)}&matchType=domain&from=${from}&to=${to}&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&limit=40`;
      const cdxRes = await fetch(cdxUrl, { signal: tvAbortSignal(job) });
      if (!cdxRes.ok) { console.warn('[tv] wayback CDX failed for', site, cdxRes.status); return []; }
      const cdxData = await cdxRes.json().catch(() => null);
      if (!Array.isArray(cdxData) || cdxData.length < 2) return []; // header row only = nothing archived that week
      const candidates = cdxData.slice(1)
        .filter((row) => {
          const url = row[2] || '';
          if (TV_WAYBACK_SKIP_PATH_RE.test(url)) return false;
          const pathPart = url.replace(/^https?:\/\/[^/]+/, '');
          return pathPart.length > 1; // exclude the bare homepage itself — we want real articles
        })
        .slice(0, 6); // cap per site — this still runs synchronously while Костян waits in the browser
      const pages = [];
      for (const row of candidates) {
        const timestamp = row[1], original = row[2];
        try {
          // the "id_" suffix asks Wayback for the raw original page, without its own
          // toolbar/link-rewriting injected — cleaner text to strip.
          const pageRes = await fetch(`https://web.archive.org/web/${timestamp}id_/${original}`, { signal: tvAbortSignal(job) });
          if (!pageRes.ok) continue;
          const html = (await pageRes.text()).slice(0, 200000); // cap before stripping, some archived pages are huge
          const text = tvStripHtml(html).slice(0, 4000);
          if (text.length < 200) continue; // too little real content to be worth sending
          const dateStr = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
          pages.push({
            kind: 'wayback',
            promptLabel: `real archived page from ${site}, dated ${dateStr}`,
            promptText: text,
            sourceUrl: `https://web.archive.org/web/${timestamp}/${original}`,
            sourceDate: dateStr,
            sourcePrecision: 'week',
            media: [],
            rawTitle: null,
          });
        } catch (err) { console.warn('[tv] wayback page fetch failed for', site, timestamp, err.message); }
      }
      if (pages.length) tvJobLog(job, `Wayback: ${site} — найдено ${pages.length} стр.`);
      return pages;
    } catch (err) { console.warn('[tv] wayback CDX request failed for', site, err.message); return []; }
  }));
  const pages = perSite.flat();
  tvJobLog(job, `Wayback Machine: итого ${pages.length} стр. из ${TV_WAYBACK_SITES.length} сайтов.`);
  return pages;
}

// Компьютерра (old.computerra.ru) — the exact period Russian IT magazine CLAUDE.md's
// Journalist section already names as the style reference. Unlike the Wayback pass above,
// this needs no CDX lookup / snapshot-timing luck at all: the outlet keeps a real,
// permanently live per-day archive index at a confirmed URL pattern —
// old.computerra.ru/archive/{year}/{month}/{day}/, month/day NOT zero-padded — Костян
// verified this live against 16.08.2001, which showed a real dated article
// ("Разнософт №11"). Every day of the target week gets its own direct fetch, so coverage
// is guaranteed rather than dependent on whether Wayback happened to snapshot that day.
//
// A day-archive page is NOT unstructured prose — it's a real list of distinct articles,
// each its own repeating `item-dir-ct item-dir-ct-2` block with a real per-article URL
// (`<h2><a href="/197823/">Title</a></h2>`), date, and a real dated blurb. The first version
// of this function flattened the whole page to one text blob and asked Gemini to find story
// boundaries in it — real content was there, but most of it was silently lost: one busy day
// (20.08.2001) turned out to hold 9 distinct real articles, confirmed by fetching and
// inspecting the raw HTML directly, and the flat-text version surfaced barely any of them.
// Parsing the real blocks directly means every real article gets its own real per-article
// sourceUrl too (no more day-index URL shared across multiple stories).
const TV_COMPUTERRA_ITEM_RE = /<h2><a href="([^"]+)">([\s\S]*?)<\/a><\/h2>[\s\S]*?<span\s+class="item-info-author">[\d.]+<\/span>[\s\S]*?<span\s*[\s\S]*?class="item-info-author">([\s\S]*?)<\/span>/;
// old.computerra.ru occasionally resets the connection outright (ECONNRESET, no HTTP status
// at all) under repeated rapid requests — confirmed live: several fetches failed this way
// during testing, then succeeded again seconds later with no code change. One retry after a
// short pause is cheap insurance against losing a whole day's real content to a transient
// blip, given each day only gets fetched once per gather anyway.
async function tvFetchWithRetry(url, attempts = 2, signal) {
  for (let i = 0; i < attempts; i++) {
    try { return await fetch(url, { signal }); }
    catch (err) {
      if (err.name === 'AbortError' || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
async function tvFetchComputerraRaw(range, job) {
  const start = new Date(range.start + 'T00:00:00Z');
  const end = new Date(range.end + 'T00:00:00Z');
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(new Date(d));

  // Sequential, not Promise.all — matches the granular "сбор первого дня..." progress the
  // console shows, and also happens to be gentler on old.computerra.ru, which occasionally
  // resets connections outright (ECONNRESET) under a burst of concurrent requests.
  const rawItems = [];
  for (const d of days) {
    tvCheckAbort(job);
    const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
    const dayUrl = `https://old.computerra.ru/archive/${year}/${month}/${day}/`;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    tvJobLog(job, `Компьютерра: собираю ${dateStr}...`);
    try {
      const pageRes = await tvFetchWithRetry(dayUrl, 2, tvAbortSignal(job));
      if (!pageRes.ok) continue; // some days genuinely have no archive page — not an error
      const html = await pageRes.text();
      const blocks = html.split('item-dir-ct item-dir-ct-2').slice(1);
      let dayCount = 0;
      for (const b of blocks) {
        const m = b.match(TV_COMPUTERRA_ITEM_RE);
        if (!m) continue;
        const relUrl = m[1];
        const title = tvStripHtml(m[2]);
        const snippet = tvStripHtml(m[3]);
        if (!title || !snippet || snippet.length < 15) continue;
        const url = relUrl.startsWith('http') ? relUrl : `https://old.computerra.ru${relUrl}`;
        rawItems.push({ url, title, snippet, dateStr });
        dayCount++;
      }
      tvJobLog(job, `Компьютерра: ${dateStr} — найдено ${dayCount} ст.`);
    } catch (err) {
      console.warn('[tv] computerra fetch failed for', dayUrl, err.message);
      tvJobLog(job, `Компьютерра: ${dateStr} — ошибка сети (${err.message}).`);
    }
  }
  if (!rawItems.length) return [];

  // The same real article occasionally gets listed under more than one day (reprints /
  // theme-issue cross-links) — de-dupe by its real per-article URL before it reaches Gemini.
  const seenUrls = new Set();
  const uniqueItems = rawItems.filter((it) => (seenUrls.has(it.url) ? false : (seenUrls.add(it.url), true)));
  tvJobLog(job, `Компьютерра: итого ${uniqueItems.length} ст. за неделю.`);
  return uniqueItems.map((it) => ({
    kind: 'computerra',
    promptLabel: `real Компьютерра article dated ${it.dateStr}, real title "${it.title}"`,
    promptText: it.snippet,
    sourceUrl: it.url,
    sourceDate: it.dateStr,
    sourcePrecision: 'week',
    media: [],
    rawTitle: it.title,
  }));
}

// Wikipedia category naming conventions that hold reliably across most years. hardware's
// pattern is a best-effort guess (less consistently populated per-year than the others) —
// harmless if it comes back empty for a given year, tvFetchWikiCategoryMembers already
// degrades to an empty list rather than erroring.
const TV_WIKI_CATEGORY_PATTERNS = {
  games: (year) => `Category:${year} video games`,
  soft: (year) => `Category:${year} software`,
  hardware: (year) => `Category:${year} computer hardware`,
  internet: (year) => `Category:Internet properties established in ${year}`,
  mobile: (year) => `Category:${year} mobile phones`,
  news: (year) => `Category:${year} in computing`,
};
const TV_WIKI_UA = { 'User-Agent': 'TAKE-ONE-TV/1.0 (retro tech news research tool; contact via repo)' };

async function tvFetchWikiCategoryMembers(category, limit, job) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(category)}&cmlimit=${limit}&format=json`;
  const res = await fetch(url, { headers: TV_WIKI_UA, signal: tvAbortSignal(job) });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const members = data && data.query && data.query.categorymembers;
  return Array.isArray(members) ? members.filter((m) => m.ns === 0).map((m) => m.title) : [];
}
async function tvFetchWikiSummary(title, job) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: TV_WIKI_UA, signal: tvAbortSignal(job) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || !data.extract) return null;
  return {
    title: data.title || title,
    extract: data.extract,
    pageUrl: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(title)),
    thumbnail: data.thumbnail && data.thumbnail.source,
  };
}
const TV_RUBRIC_RU_LABELS = { news:'Новости', games:'Игры', soft:'Софт', hardware:'Железо', internet:'Интернет', mobile:'Мобильные' };
async function tvFetchWikipediaRaw(range, job) {
  const year = Number(range.start.slice(0, 4));
  const summaries = [];
  tvJobLog(job, `Wikipedia: проверяю категории за ${year} год...`);
  for (const rubric of Object.keys(TV_WIKI_CATEGORY_PATTERNS)) {
    tvCheckAbort(job);
    try {
      const category = TV_WIKI_CATEGORY_PATTERNS[rubric](year);
      // Was capped at 8 fetched / 4 used per rubric — needlessly thin given Wikipedia
      // categories for a given year commonly hold far more real members than that, and
      // this pass is free (no per-request cost beyond Wikipedia's own generous rate limits).
      const titles = await tvFetchWikiCategoryMembers(category, 25, job);
      let rubricCount = 0;
      for (const title of titles.slice(0, 12)) {
        try {
          const summary = await tvFetchWikiSummary(title, job);
          if (summary) { summaries.push(Object.assign({ rubricHint: rubric }, summary)); rubricCount++; }
        } catch (err) { console.warn('[tv] wikipedia summary failed for', title, err.message); }
      }
      tvJobLog(job, `Wikipedia: ${TV_RUBRIC_RU_LABELS[rubric] || rubric} — найдено ${rubricCount} ст.`);
    } catch (err) { console.warn('[tv] wikipedia category fetch failed for', rubric, err.message); }
  }
  return summaries.map((s) => ({
    kind: 'wikipedia',
    promptLabel: `rubric hint "${s.rubricHint}", real Wikipedia article "${s.title}"`,
    promptText: s.extract,
    sourceUrl: s.pageUrl,
    sourceDate: null,
    sourcePrecision: 'year',
    media: s.thumbnail ? [{ type: 'image', url: s.thumbnail, title: s.title }] : [],
    rawTitle: s.title,
  }));
}

// Combines raw records from however many sources were enabled into ONE Gemini structuring
// call — this is the fix for hitting the free tier's 20 requests/minute cap: every source
// used to make its own separate call (up to 3 per gather, plus a 4th for the opt-in
// month-fallback), which added up fast across repeated clicks. The instruction below covers
// all three record kinds generically (raw scraped page text may have noise to skip through;
// Компьютерра/Wikipedia records are already real, individually-identified articles that
// should almost always produce an item) since a single combined prompt can't special-case
// per source without ballooning back into per-source calls.
async function tvStructureRawRecords(rawRecords, job) {
  if (!rawRecords.length) return [];
  const sourceBlock = rawRecords.map((r, i) => `[SOURCE ${i}: ${r.promptLabel}]\n${r.promptText}`).join('\n\n');
  const instruction = [
    'The following are real source records about IT/technology, video games, software, or internet topics — some are literally-retrieved text from archived tech-news web pages (may contain navigation/ad/boilerplate noise mixed with real story text), some are real individually-identified Компьютерра magazine articles with their own real titles (already real distinct stories, not noise), some are real Wikipedia article summaries. Every record is REAL — retrieved or extracted directly, never invented.',
    'For EACH numbered source below, if it contains a genuine IT/technology/games/software/internet news story, produce one structured item: a short Russian title, a factual 1-3 sentence Russian summary based ONLY on the given text, and which sourceIndex it came from. Never invent a fact, name, or number not present in the given text.',
    'rubric must be exactly one of: news, games, soft, hardware, internet, mobile — use any rubric hint given as a starting point but correct it if the content clearly belongs elsewhere.',
    'imageQuery: a short English search phrase (2-5 words) for finding a real illustrative photo of this story.',
    'A source whose label says it is already a real individually-identified article (Компьютерра) should almost always produce an item — skip it only if its given text is truly too vague to summarize. A source that is raw scraped page text may have no real story content at all — skip those rather than inventing one.',
    'Respond with ONLY the JSON object, nothing else.',
    '', sourceBlock,
  ].join('\n');

  tvJobLog(job, `Gemini: обрабатываю ${rawRecords.length} записей...`);
  const items = await tvCallGeminiStructuring(instruction, true, job);
  tvJobLog(job, `Gemini: получено ${items.length} новостей.`);
  return items.map((it) => {
    const src = rawRecords[it.sourceIndex];
    if (!src) return null;
    return {
      rubric: it.rubric, title: it.title || src.rawTitle, summary: it.summary, imageQuery: it.imageQuery,
      source: src.kind, sourcePrecision: src.sourcePrecision,
      sourceUrl: src.sourceUrl, sourceDate: src.sourceDate,
      extract: src.promptText.slice(0, 500),
      media: src.media,
    };
  }).filter(Boolean);
}

// Real (free, keyless) illustrative photo per item — Wikipedia items may already have a
// thumbnail from their own page summary; everything else (all Wayback items, and any
// Wikipedia item whose article had no thumbnail) gets one real Commons search. Video
// sourcing (YouTube Data API) is a deliberate NOT-YET — needs its own API key/quota setup,
// deferred until Костян sets that up.
async function tvSearchCommonsImage(query, job) {
  if (!query) return null;
  try {
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&format=json&srlimit=3`;
    const searchRes = await fetch(searchUrl, { headers: TV_WIKI_UA, signal: tvAbortSignal(job) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json().catch(() => null);
    const results = searchData && searchData.query && searchData.query.search;
    if (!Array.isArray(results) || !results.length) return null;
    const title = results[0].title;
    const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json`;
    const infoRes = await fetch(infoUrl, { headers: TV_WIKI_UA, signal: tvAbortSignal(job) });
    if (!infoRes.ok) return null;
    const infoData = await infoRes.json().catch(() => null);
    const pages = infoData && infoData.query && infoData.query.pages;
    const page = pages && Object.values(pages)[0];
    const info = page && page.imageinfo && page.imageinfo[0];
    const url = info && (info.thumburl || info.url);
    return url ? { type: 'image', url, title } : null;
  } catch (err) {
    console.warn('[tv] commons image search failed for', query, err.message);
    return null;
  }
}

// All 6 rubrics — kept here (not imported from tv-state.js, which the server doesn't load)
// purely to check real coverage per gather; must stay in sync with TV_RUBRICS client-side.
const TV_ALL_RUBRIC_KEYS = ['news', 'games', 'soft', 'hardware', 'internet', 'mobile'];

// Full gather run for one background job — same logic the old single blocking route used to
// run inline, just instrumented with tvJobLog calls at each real milestone and tvCheckAbort
// calls between phases so "Стоп" (js/tv-app.js) can actually interrupt it. Runs detached
// (the route below does not await this) — the client learns what happened by polling
// /api/tv/gather-news/status/:jobId, same start+poll shape already used for KIE tasks.
async function tvRunGatherJob(job, range, sel) {
  try {
    tvJobLog(job, `Начинаю сбор новостей за ${range.start} — ${range.end}.`);
    // sourceErrors carries each source's REAL failure message through to the client —
    // previously a real problem (Gemini quota/rate-limit, safety block, network error) was
    // swallowed into a bare console.warn and looked identical on screen to "genuinely
    // nothing was found here."
    const sourceErrors = {};
    const waybackRaw = sel.wayback
      ? await tvFetchWaybackRaw(range, job).catch((err) => { tvJobLog(job, 'Wayback: ошибка — ' + err.message); sourceErrors.wayback = err.message; return []; })
      : [];
    tvCheckAbort(job);
    const wikipediaRaw = sel.wikipedia
      ? await tvFetchWikipediaRaw(range, job).catch((err) => { tvJobLog(job, 'Wikipedia: ошибка — ' + err.message); sourceErrors.wikipedia = err.message; return []; })
      : [];
    tvCheckAbort(job);
    const computerraRaw = sel.computerra
      ? await tvFetchComputerraRaw(range, job).catch((err) => { tvJobLog(job, 'Компьютерра: ошибка — ' + err.message); sourceErrors.computerra = err.message; return []; })
      : [];
    tvCheckAbort(job);

    // The actual Gemini call is ONE combined call over everything gathered, not one per
    // source — the direct fix for hitting the free tier's 20 requests/minute quota, which
    // up to 3-4 separate structuring calls per click used to burn through fast.
    let items;
    try {
      items = await tvStructureRawRecords([...waybackRaw, ...wikipediaRaw, ...computerraRaw], job);
    } catch (err) {
      tvJobLog(job, 'Gemini: ошибка — ' + err.message);
      sourceErrors.gemini = err.message;
      items = [];
    }

    // Костян's requirement: every rubric should end up with at least one real item, and if
    // one genuinely can't be found for the exact week, say so honestly rather than silently
    // leaving it empty — then, ONLY if the "Расширять до месяца" checkbox is on, widen to a
    // ~30-day window (still real, sourced items, never invented) as a fallback, clearly
    // tagged sourcePrecision:'month'. Off by default: a month-wide item isn't really "the
    // selected week" any more than Wikipedia's year-precision is, so this stays opt-in.
    let emptyRubrics = TV_ALL_RUBRIC_KEYS.filter((r) => !items.some((i) => i.rubric === r));
    let filledFromFallback = [];
    if (emptyRubrics.length && sel.monthFallback) {
      tvCheckAbort(job);
      tvJobLog(job, 'Расширяю поиск до месяца для: ' + emptyRubrics.map((r) => TV_RUBRIC_RU_LABELS[r] || r).join(', ') + '.');
      try {
        const monthRange = tvMonthRange(range);
        const monthRaw = await tvFetchWaybackRaw(monthRange, job);
        const fallbackItems = await tvStructureRawRecords(monthRaw, job);
        const stillMissing = new Set(emptyRubrics);
        const picked = fallbackItems.filter((i) => stillMissing.has(i.rubric));
        picked.forEach((i) => { i.sourcePrecision = 'month'; });
        items = items.concat(picked);
        filledFromFallback = [...new Set(picked.map((i) => i.rubric))];
        emptyRubrics = emptyRubrics.filter((r) => !filledFromFallback.includes(r));
      } catch (err) {
        tvJobLog(job, 'Расширение до месяца: ошибка — ' + err.message);
        sourceErrors.monthFallback = err.message;
      }
    }

    tvCheckAbort(job);
    if (items.length) tvJobLog(job, `Ищу иллюстрации для ${items.length} новостей...`);
    await Promise.all(items.map(async (item) => {
      if (item.media && item.media.length) return; // already has a real thumbnail (Wikipedia)
      const img = await tvSearchCommonsImage(item.imageQuery || item.title, job);
      if (img) item.media = [img];
      delete item.imageQuery; // internal-only, not needed by the client
    }));

    tvJobLog(job, `Готово — добавлено ${items.length} новостей.`);
    job.result = { items, weekStart: range.start, weekEnd: range.end, emptyRubrics, filledFromFallback, sourceErrors };
    job.status = 'done';
  } catch (err) {
    if (err instanceof TvJobAborted) {
      tvJobLog(job, 'Остановлено пользователем.');
      job.status = 'cancelled';
      job.result = { items: [], weekStart: range.start, weekEnd: range.end, emptyRubrics: [], filledFromFallback: [], sourceErrors: {} };
    } else {
      console.error('[server] gather-news job failed:', err);
      tvJobLog(job, 'Ошибка: ' + err.message);
      job.status = 'failed';
      job.result = { items: [], weekStart: range.start, weekEnd: range.end, emptyRubrics: TV_ALL_RUBRIC_KEYS, filledFromFallback: [], sourceErrors: { general: err.message } };
    }
  }
}

app.post('/api/tv/gather-news/start', (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on the server yet.' });
  }
  const { weekStart, weekEnd, sources } = req.body || {};
  const range = (weekStart && weekEnd) ? { start: weekStart, end: weekEnd } : tvHistoricalWeekRange();
  // Which real sources to actually query, per the checkboxes next to "Собрать новости"
  // (js/tv-app.js). Missing/malformed selection defaults to everything ON — safe fallback
  // for any caller that doesn't send the field, never a reason to silently return nothing.
  const sel = sources && typeof sources === 'object'
    ? sources
    : { wayback: true, computerra: true, wikipedia: true, monthFallback: true };
  const job = tvCreateGatherJob();
  tvRunGatherJob(job, range, sel); // fire-and-forget — client polls status below
  res.json({ jobId: job.id });
});
app.get('/api/tv/gather-news/status/:jobId', (req, res) => {
  const job = tvGatherJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'not_found', message: 'Задача не найдена — возможно, истекла или сервер перезапустился.' });
  res.json({ status: job.status, log: job.log, result: (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') ? job.result : null });
});
app.post('/api/tv/gather-news/cancel/:jobId', (req, res) => {
  const job = tvGatherJobs.get(req.params.jobId);
  if (job && job.status === 'running') {
    job.aborted = true;
    job.abortController.abort(); // interrupts whatever fetch is currently in flight, not just future steps
  }
  res.json({ ok: true });
});

// ---- text-writing (Journalist) — turns a sourced news item into the anchor's on-air read,
// in that specific host's voice. Gemini is the free option (same key already used for
// gather-news). The two paid options go through KIE.ai (same KIE_API_KEY as everything
// else) — request shapes below come from real docs.kie.ai pages fetched while building
// this (docs.kie.ai/market/chat/gpt-5-4, and the Claude-Code integration guide confirming
// the /claude base + standard Anthropic Messages API shape), NOT guessed — but neither has
// actually been called for real yet (no live KIE_API_KEY while building this), so treat
// them as "should work per the docs" rather than fully proven, unlike the image/video/
// lipsync models above (whose exact shapes were confirmed the hard way over real attempts —
// see LIPSYNC_MODELS's comment). costUsd on both is a rough estimate (short text call,
// no real bill yet) — correct against KIE's dashboard once one actually runs.
const TV_TEXT_MODELS = [
  { id: 'gemini-text', label: 'Gemini (бесплатно)', costUsd: 0, blurb: 'Тот же ключ и тир, что уже используется для сбора новостей' },
  { id: 'kie-gpt-5-4', label: 'GPT 5.4 (KIE.ai)', costUsd: 0.02, blurb: 'Платно, через тот же ключ KIE — короткий текстовый вызов, цена оценочная', provider: 'kie-gpt' },
  { id: 'kie-claude-sonnet', label: 'Claude Sonnet (KIE.ai)', costUsd: 0.02, blurb: 'Платно, через тот же ключ KIE — короткий текстовый вызов, цена оценочная', provider: 'kie-claude' },
];
app.get('/api/tv/text-models', (req, res) => {
  res.json({ models: TV_TEXT_MODELS });
});
async function tvCallGeminiText(prompt) {
  const geminiRes = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  const data = await geminiRes.json().catch(() => null);
  if (!geminiRes.ok) throw new Error((data && data.error && data.error.message) || ('Gemini rejected the request (HTTP ' + geminiRes.status + ').'));
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini returned an empty response — it may have been blocked by a safety filter.');
  return text;
}
// docs.kie.ai/market/chat/gpt-5-4: POST https://api.kie.ai/codex/v1/responses, a synchronous
// chat-completions-style endpoint (not the async createTask+webhook pattern the image/video
// models use). Real response shape now confirmed live against docs.kie.ai's own example
// (it 404'd/403'd during earlier research, loaded fine this time):
//   { output: [ {type:'reasoning', ...no content...}, {type:'message', content:[{type:
//   'output_text', text:'...'}]} ], usage:{...}, status:'completed' }
// The old code assumed output[0] was the message — wrong: reasoning models put a
// no-`content` "reasoning" item first, so output[0].content was undefined and the real text
// (in a later "message" item) was never found — that's the real cause of "KIE.ai (GPT)
// returned no text". Also dropped the `output_text` top-level fallback: that field is a
// convenience property OpenAI's own SDKs synthesize client-side, not something present in
// the raw HTTP response body a proxy like KIE would actually send.
async function tvCallKieGptText(prompt) {
  const res = await fetch(`${KIE_BASE}/codex/v1/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5-4', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error && data.error.message) || ('KIE.ai (GPT) rejected the request (HTTP ' + res.status + ').'));
  const messageItem = data && Array.isArray(data.output) && data.output.find((o) => o.type === 'message');
  const textItem = messageItem && Array.isArray(messageItem.content) && messageItem.content.find((c) => c.type === 'output_text');
  const text = textItem && textItem.text;
  if (!text) throw new Error('KIE.ai (GPT) returned no text — response shape: ' + JSON.stringify(data).slice(0, 500));
  return text;
}
// The Claude-Code-via-KIE integration guide confirms the base is https://api.kie.ai/claude,
// proxying Anthropic's own Messages API (/v1/messages) as-is — same request/response shape
// as api.anthropic.com, just a different base URL + key. Model id is a best-current-guess
// (claude-sonnet-5), not confirmed against KIE's own proxy specifically.
async function tvCallKieClaudeText(prompt) {
  const res = await fetch(`${KIE_BASE}/claude/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error && data.error.message) || ('KIE.ai (Claude) rejected the request (HTTP ' + res.status + ').'));
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) throw new Error('KIE.ai (Claude) returned no text.');
  return text;
}
// No requireAuth on the free Gemini path — same reasoning as /api/tv/gather-news: $0 cost,
// nothing to bill. The two paid KIE paths below DO cost real money per call but still skip
// requireAuth/checkUserCanAfford for now, matching /TV's whole billing model (Костян is the
// only user of /TV right now; the shared credits system exists for TAKE:ONE's main users,
// not /TV specifically) — revisit if /TV ever gets more than one real user.
// Компьютерра's day-archive blurb (`extract`, saved at gather-time) is short — the real
// article, at its own per-article URL, is much richer (confirmed live: a real article body
// ran several thousand characters once stripped, vs. ~150 chars of blurb). Re-fetching it
// only NOW, at write-time, rather than for every gathered item up front, keeps the gather
// step cheap (most gathered items never get written) and only pays the extra fetch for
// stories Костян actually picked. Only Компьютерра — the other sources' `extract` already
// IS the real fetched page text (Wayback) or the real Wikipedia summary (no separate
// "short version" to upgrade from).
async function tvFetchComputerraFullArticle(sourceUrl) {
  const res = await fetch(sourceUrl);
  if (!res.ok) return null;
  const html = await res.text();
  // Real per-article pages wrap the actual story in <div class="article">...<!-- fin -->,
  // right before the page's shared <div class="bottom"> footer — confirmed live against a
  // real article (old.computerra.ru/197827/, "VIAдук для Pentium 4"). Falls back to the
  // whole page if that landmark ever moves, rather than failing outright.
  const start = html.indexOf('<div class="article">');
  const end = html.indexOf('<div class="bottom">');
  const slice = (start >= 0 && end > start) ? html.slice(start, end) : html;
  const text = tvStripHtml(slice);
  return text.length > 100 ? text.slice(0, 6000) : null;
}

app.post('/api/tv/write-article', async (req, res) => {
  const { title, summary, extract, rubric, sourceDate, sourceUrl, source, personaContext, chosenCatchphrase, chosenAction, model } = req.body || {};
  if (!title || !personaContext) {
    return res.status(400).json({ error: 'bad_request', message: 'title and personaContext are both required.' });
  }
  const matched = TV_TEXT_MODELS.find(m => m.id === model) || TV_TEXT_MODELS[0];
  if (matched.provider && !KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  if (!matched.provider && !GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on the server yet.' });
  }
  const year = (sourceDate && parseInt(String(sourceDate).slice(0, 4), 10)) || (new Date().getUTCFullYear() - 25);

  let fullExtract = extract;
  if (source === 'computerra' && sourceUrl) {
    try {
      const full = await tvFetchComputerraFullArticle(sourceUrl);
      if (full) fullExtract = full;
    } catch (err) { console.warn('[tv] computerra full-article fetch failed for', sourceUrl, err.message); }
  }

  const prompt = [
    `Ты пишешь текст, который ведущий прочитает в кадре в эфире российской телепередачи про технологии, выходящей в ${year} году. Это не статья — это устная речь для эфира.`,
    `Тема сюжета: «${title}».`,
    summary ? `Краткое содержание: ${summary}` : '',
    fullExtract ? `Реальный исходный текст по теме (используй только факты отсюда, ничего не выдумывай):\n${fullExtract}` : '',
    `Рубрика: ${rubric || 'не указана'}.`,
    `Вот кто ведёт эту рубрику — пиши строго от его лица, с его манерой и характером:`,
    personaContext,
    `Требования:`,
    `- Только реальные факты из исходного текста выше — ничего не придумывай и не домысливай.`,
    `- Никаких понятий и технологий, которых ещё не существовало на момент ${year} года.`,
    `- Никаких списков, подзаголовков, канцелярских оборотов, штампов вроде "подводя итог" или искусственной "сбалансированности". Живая устная речь для эфира — с ритмом, характерными для ведущего словами-паразитами и репликами, реальным мнением, а не нейтральным пересказом.`,
    // The two lines below are where the character's personality is actually meant to show
    // through, per Костян: "должна происходить та самая магия, где раскрывается личность".
    chosenCatchphrase ? `- У этого ведущего есть коронная фраза: «${chosenCatchphrase}». Вплети её туда, где она органично звучит — не обязательно в самом начале, и не заставляй её звучать, если не подходит по смыслу.` : '',
    chosenAction ? `- У этого ведущего есть фирменное действие в кадре: «${chosenAction}». Добавь ОДНУ ремарку об этом действии в скобках в подходящем месте текста — например "(${chosenAction})". Это режиссёрская ремарка для съёмки, а не текст на озвучку — она не должна звучать как часть устной речи, только как пометка в скобках.` : '',
    `- Длина — на 20-40 секунд эфирного времени (примерно 50-100 слов), не считая ремарки в скобках.`,
    `Ответь только самим текстом для эфира (с ремаркой в скобках, если она есть), без пояснений и без кавычек вокруг него.`,
  ].filter(Boolean).join('\n\n');

  try {
    let text;
    if (matched.provider === 'kie-gpt') text = await tvCallKieGptText(prompt);
    else if (matched.provider === 'kie-claude') text = await tvCallKieClaudeText(prompt);
    else text = await tvCallGeminiText(prompt);
    res.json({ text: text.trim(), model: matched.id });
  } catch (err) {
    console.error('[server] /api/tv/write-article failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- structural host text (Сетка's host_intro/rubric_intro/outro blocks) — the connective
// tissue between stories, always the whole-show host's lines (never a rubric specialist's).
// Deliberately a direct, un-queued call (not TASKS) — this is meant to feel like nudging an
// actor for another take, tried a few times in a row while writing, not a heavyweight job.
// Gemini only, no model picker — matches that "quick iteration" framing. `directive` is
// whatever the user currently has typed in the text box when they click "Сделать
// ведущему" — treated as a steering note (mood/context), NOT dictated word-for-word.
app.post('/api/tv/write-block-text', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on the server yet.' });
  }
  const { blockType, rubricLabel, episodeSummary, directive, personaContext } = req.body || {};
  if (!blockType || !personaContext) {
    return res.status(400).json({ error: 'bad_request', message: 'blockType and personaContext are both required.' });
  }
  const roleText = {
    host_intro: 'Ты — ведущий передачи. Это твой выход в начале эфира: поприветствуй зрителя и коротко анонсируй, что будет в сегодняшнем выпуске.',
    rubric_intro: `Ты — ведущий передачи. Анонсируй зрителю следующую рубрику: «${rubricLabel || ''}». Только подводка к рубрике — не пересказывай, что в ней будет, просто заинтересуй.`,
    outro: 'Ты — ведущий передачи. Попрощайся со зрителем в конце выпуска.',
  }[blockType];
  if (!roleText) {
    return res.status(400).json({ error: 'bad_request', message: 'blockType must be host_intro, rubric_intro, or outro.' });
  }

  const prompt = [
    roleText,
    episodeSummary ? `Вот что реально попало в этот выпуск:\n${episodeSummary}` : '',
    `Вот кто ведёт передачу — пиши строго от его лица, с его манерой и характером:`,
    personaContext,
    directive ? `Дополнительное указание от режиссёра о том, в каком настроении/контексте это сказать (используй как направление, не читай вслух буквально): ${directive}` : '',
    `Требования:`,
    `- Живая устная речь для эфира, короткая (10-20 секунд, примерно 20-40 слов).`,
    `- Никаких списков, подзаголовков, канцелярских оборотов, штампов вроде "подводя итог".`,
    `Ответь только самим текстом для эфира, без пояснений и без кавычек вокруг него.`,
  ].filter(Boolean).join('\n\n');

  try {
    const text = await tvCallGeminiText(prompt);
    res.json({ text: text.trim() });
  } catch (err) {
    console.error('[server] /api/tv/write-block-text failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- voicing — turns approved article text into audio (Микрофонная tab). Gemini TTS
// (native audio output, same generateContent shape as everything else Gemini here, just
// with responseModalities:['AUDIO']) returns raw PCM inline as base64 — wrapped into a
// standard WAV header below so the browser's <audio> element can actually play it without
// needing a separate decoder. ElevenLabs via KIE.ai is the paid alternative (better
// emotional range, 60+ named voices) — request shape (input: {text, voice, stability,
// similarity_boost, style, speed, ...}) confirmed from real docs.kie.ai fetches for BOTH
// `elevenlabs/text-to-speech-turbo-2-5` and `elevenlabs/text-to-speech-multilingual-v2`
// (identical field names, just different model id/quality tier). Started on turbo-2-5;
// switched to multilingual-v2 after a real run came back "Internal Error, Please try again
// later" (HTTP 500) from KIE — multilingual-v2 is the more established/mainstream ElevenLabs
// tier, worth trying as the more likely one to actually be live on KIE's platform. Same
// async createTask+recordInfo pattern the image/video models already use here, NOT the
// synchronous shape the KIE text models above use. If this one 500s too, that points at
// something more systematic (wrong field name, auth, KIE-side outage) rather than a
// model-specific issue — worth telling me the exact error either way.
//
// Gemini TTS via KIE.ai (kie-gemini-tts below) is deliberately ALSO listed even though it's
// paid and the exact same model is already free direct from Google above — the point isn't
// quality, it's a genuinely separate quota/billing path (KIE credits, not the GEMINI_API_KEY
// free tier), so it still works as a fallback on a day the free tier's rate limit is
// exhausted. Two earlier guesses (`gemini-3.1-flash-tts`, `gemini-3-1-flash-tts` — no
// `google/` prefix) failed for real ("model name ... not supported"), and a follow-up
// search-based guess (`gemini-2-5-flash-tts`, still no prefix) was never actually confirmed
// either. KIE support then pointed directly at the real docs pages
// (docs.kie.ai/market/google/gemini-3-1-flash-tts), which loaded for real this time and
// showed BOTH the real cause of the earlier failures (missing `google/` prefix — the real
// id is `google/gemini-3-1-flash-tts`, confirming the 3.1 tier DOES exist after all) and a
// completely different request shape than assumed: not a simple {text, voice}, but a
// multi-speaker dialogue shape ({speakers:[{speaker_id,voice_name,...}],
// dialogue_turns:[{speaker_id,text}]}) — see tvCallKieGeminiVoice below. `voice_name`'s
// documented enum (Achernar, Achird, Algenib, ... Zephyr, Zubenelgenubi) matches Google's
// own native Gemini TTS voice names one-for-one, so the same voiceId already stored on each
// anchor for the free-tier path works here unchanged, no separate field needed.
const TV_VOICE_MODELS = [
  { id: 'gemini-tts', label: 'Gemini 2.5 Flash TTS (бесплатно)', costUsd: 0, blurb: 'Тот же ключ, что и для текста — уже проверена вживую, реально работает' },
  { id: 'gemini-tts-next', label: 'Gemini 3.1 Flash TTS (бесплатно)', costUsd: 0, blurb: 'Тот же ключ, новее — вживую ещё не проверялась', geminiModelKey: 'next' },
  { id: 'kie-gemini-tts', label: 'Gemini 3.1 Flash TTS (KIE.ai)', costUsd: 0.03, blurb: 'Платно, через ключ KIE — отдельная квота на случай, если бесплатный Gemini лимит исчерпан; реальная схема запроса подтверждена доками KIE после ответа саппорта', provider: 'kie-gemini' },
  // 500-ошибка отсюда, которую ловили раньше, по подтверждению саппорта KIE — временный
  // сбой на их стороне, не проблема формы запроса или прав аккаунта. Код ниже не менялся.
  { id: 'kie-elevenlabs-multi', label: 'ElevenLabs Multilingual v2 (KIE.ai)', costUsd: 0.05, blurb: 'Платно, через тот же ключ KIE — живее интонация, 60+ голосов на выбор, цена оценочная', provider: 'kie-elevenlabs' },
  // Прямой ключ ElevenLabs (не через KIE) — самый выразительный голос, поддерживает тэги
  // эмоций в тексте вроде [excited] (сама вставка тэгов — отдельный, ещё не built шаг).
  // Требует anchor.elevenLabsVoiceId — эта запись всегда в базовом списке, но клиент
  // (tvTaskModelOptions, js/tv-app.js) прячет её из выбора для ведущих без настроенного
  // голоса и подставляет имя ведущего в название, когда голос есть.
  { id: 'elevenlabs-v3', label: 'ElevenLabs v3', costUsd: 0.1, blurb: 'Прямой ключ ElevenLabs, минуя KIE — самый живой голос; цена оценочная по тарифам ElevenLabs', provider: 'elevenlabs-direct' },
];
app.get('/api/tv/voice-models', (req, res) => {
  res.json({ models: TV_VOICE_MODELS });
});
// Shared by every KIE TTS model here — same createTask+recordInfo async pattern the
// image/video models use, just returning the finished audio's real URL instead of an image
// URL. `label` is only for error messages, so a failure names which provider actually failed.
async function tvCallKieAudioTask(kieModelId, input, label) {
  const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: kieModelId, input }),
  });
  const createData = await createRes.json().catch(() => null);
  const taskId = createData && createData.data && createData.data.taskId;
  if (!createRes.ok || !taskId) {
    throw new Error((createData && createData.msg) || (`KIE.ai (${label}) rejected the request (HTTP ` + createRes.status + ').'));
  }
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    const pollData = await pollRes.json().catch(() => null);
    const d = pollData && pollData.data;
    if (!d) continue;
    const state = (d.state || '').toLowerCase();
    const flag = Number(d.successFlag);
    if (state === 'fail' || flag === 2 || d.failMsg) throw new Error(d.failMsg || `${label} (KIE) generation failed.`);
    if (state === 'success' || flag === 1) {
      const url = extractResultUrl(d);
      if (url) return url;
    }
  }
  throw new Error(`${label} (KIE) generation timed out.`);
}
async function tvCallKieElevenLabsVoice(text, voiceId, speed) {
  // voice: our anchor.voiceId currently holds a Gemini voice NAME (e.g. "Kore"), not an
  // ElevenLabs voice ID — the two engines don't share an id space, so this falls back to a
  // default ElevenLabs voice ("James") whenever a Gemini name is passed in. A real fix needs
  // a separate per-provider voice field on the anchor (see CLAUDE.md).
  return tvCallKieAudioTask(
    'elevenlabs/text-to-speech-multilingual-v2',
    { text, voice: voiceId || 'EkK5I93UQWFDigLMpZcX', speed: speed || 1 },
    'ElevenLabs'
  );
}
// Real confirmed shape (docs.kie.ai/market/google/gemini-3-1-flash-tts, see the big comment
// above TV_VOICE_MODELS) — a multi-speaker dialogue API, not a plain {text, voice} call.
// One speaker is enough for our single-anchor voiceover use; speaker_id just needs to match
// between the two arrays, its exact string doesn't matter beyond that.
async function tvCallKieGeminiVoice(text, voiceId) {
  return tvCallKieAudioTask(
    'google/gemini-3-1-flash-tts',
    {
      speakers: [{ speaker_id: 'Speaker 1', voice_name: voiceId || 'Kore' }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text }],
    },
    'Gemini TTS'
  );
}
// Real confirmed shape (docs.elevenlabs.io/api-reference/text-to-speech/convert) — a single
// synchronous POST, the response body IS the finished audio (mp3), no polling. `voiceId`
// must be a real ElevenLabs voice_id (anchor.elevenLabsVoiceId, a separate id space from the
// Gemini voice names anchor.voiceId holds — see the anchor form). stability:0.3 approximates
// where Костян had the "Stability" slider (leaning "Creative") on his own account for Dima
// Maksimov's "Alex" voice — a single shared default for now, not yet per-anchor tunable.
async function tvCallElevenLabsDirectVoice(text, voiceId) {
  const res = await fetch(`${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      voice_settings: { stability: 0.3 },
      language_code: 'ru',
      output_format: 'mp3_44100_128',
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs rejected the request (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
function tvPcmToWav(pcmBuffer, sampleRate, numChannels, bitsPerSample) {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}
// No requireAuth — same reasoning as write-article above (/TV has one real user right now;
// the shared credits system exists for TAKE:ONE's main users, not /TV specifically).
app.post('/api/tv/generate-voice', async (req, res) => {
  const { text, voiceName, voiceSpeed, model } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'bad_request', message: 'text is required.' });
  }
  const matched = TV_VOICE_MODELS.find(m => m.id === model) || TV_VOICE_MODELS[0];
  if (matched.provider === 'elevenlabs-direct' && !ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'ELEVENLABS_API_KEY is not set on the server yet.' });
  }
  if (matched.provider && matched.provider !== 'elevenlabs-direct' && !KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  if (!matched.provider && !GEMINI_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on the server yet.' });
  }
  if (matched.provider === 'elevenlabs-direct' && !voiceName) {
    return res.status(400).json({ error: 'bad_request', message: 'Этому ведущему не задан ElevenLabs Voice ID — заполните поле в карточке ведущего.' });
  }
  // Parenthetical remarks (e.g. "(Макс достаёт из кармана планку памяти)") are stage
  // directions for filming, baked into articleText by /api/tv/write-article — never meant
  // to be read aloud. Strip them here, right before they'd reach any TTS provider; the
  // stored articleText itself keeps them intact for later (Сетка / a future virtual editor
  // reading them as shot instructions — see CLAUDE.md's "Studios + virtual editor" section).
  const parenStripped = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || text;
  // [tag] emotion/delivery tags (e.g. "[excited]", inserted via Микрофонная's tag buttons)
  // are ElevenLabs v3-specific — every other provider would read "[excited]" aloud as
  // literal text. Only v3 gets to see them; everyone else gets them stripped too.
  const spokenText = matched.provider === 'elevenlabs-direct'
    ? parenStripped
    : (parenStripped.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim() || parenStripped);
  try {
    if (matched.provider === 'elevenlabs-direct') {
      const buf = await tvCallElevenLabsDirectVoice(spokenText, voiceName);
      res.set('Content-Type', 'audio/mpeg');
      res.set('X-TV-Voice-Model', matched.id);
      return res.send(buf);
    }
    if (matched.provider === 'kie-elevenlabs' || matched.provider === 'kie-gemini') {
      const speedNum = { slow: 0.85, normal: 1, fast: 1.15 }[voiceSpeed] || 1;
      const audioUrl = matched.provider === 'kie-gemini'
        ? await tvCallKieGeminiVoice(spokenText, voiceName)
        : await tvCallKieElevenLabsVoice(spokenText, voiceName, speedNum);
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) throw new Error('Could not download the generated audio from KIE.ai.');
      const buf = Buffer.from(await audioRes.arrayBuffer());
      res.set('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
      res.set('X-TV-Voice-Model', matched.id);
      return res.send(buf);
    }
    // Gemini's native TTS has no separate numeric speed parameter — the documented way to
    // steer delivery is a natural-language style prefix ("Say cheerfully: ...") that the
    // model is tuned to treat as a direction rather than something to read aloud. Mirrors
    // that convention in Russian; best-effort, not independently confirmed to be reliable.
    const speedPrefix = voiceSpeed === 'slow' ? 'Прочитай медленно и размеренно: '
      : voiceSpeed === 'fast' ? 'Прочитай быстро и энергично: ' : '';
    const geminiModel = matched.geminiModelKey === 'next' ? GEMINI_TTS_MODEL_NEXT : GEMINI_TTS_MODEL;
    const geminiRes = await fetch(`${GEMINI_BASE}/models/${geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: speedPrefix + spokenText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } },
        },
      }),
    });
    const data = await geminiRes.json().catch(() => null);
    if (!geminiRes.ok) throw new Error((data && data.error && data.error.message) || ('Gemini rejected the request (HTTP ' + geminiRes.status + ').'));
    const part = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0];
    const inline = part && part.inlineData;
    if (!inline || !inline.data) throw new Error('Gemini returned no audio — it may have been blocked by a safety filter.');
    const rateMatch = /rate=(\d+)/.exec(inline.mimeType || '');
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const pcmBuffer = Buffer.from(inline.data, 'base64');
    const wavBuffer = tvPcmToWav(pcmBuffer, sampleRate, 1, 16);
    res.set('Content-Type', 'audio/wav');
    res.set('X-TV-Voice-Model', matched.id);
    res.send(wavBuffer);
  } catch (err) {
    console.error('[server] /api/tv/generate-voice failed:', err);
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
  { id: 'kling/v2-1-standard', label: 'Kling 2.1 Standard', costUsd: 0.125, blurb: '720p — fastest and cheapest, solid everyday motion', resolutionClass: '720p' },
  { id: 'kling/v2-1-pro', label: 'Kling 2.1 Pro', costUsd: 0.25, blurb: '1080p — smoother, more realistic motion', resolutionClass: '1080p' },
  { id: 'kling/v2-1-master-image-to-video', label: 'Kling 2.1 Master', costUsd: 0.80, blurb: '1080p — best quality, realistic physics and camera work, priciest', resolutionClass: '1080p' },
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
  { id: 'bytedance/seedance-2-fast', label: 'Seedance 2.0 Fast', costUsd: 0.80, blurb: 'Supports first+last frame — animates a clean transition between two chosen images', supportsLastFrame: true, imageFieldName: 'first_frame_url', resolutionClass: '720p' },
  // Confirmed via a literal docs.kie.ai request example (model id "bytedance/seedance-2",
  // same first_frame_url/last_frame_url convention as Fast) — the full/standard tier: up to
  // 4K, stronger multi-shot consistency, ~5min vs Fast's ~4min. costUsd is an unconfirmed
  // guess (no real bill yet, unlike Fast's recalibrated figure above) — flagged the same
  // way every other unverified cost estimate has been; correct it against KIE's dashboard
  // once a real generation runs. Deliberately NOT wiring the extra multi-reference/native
  // audio inputs this pass (reference_image_urls/reference_video_urls/reference_audio_urls/
  // generate_audio) — those are a bigger, separate feature to design later, not a drop-in.
  { id: 'bytedance/seedance-2', label: 'Seedance 2.0', costUsd: 1.10, blurb: 'Full/standard tier — stronger multi-shot consistency, up to 4K, for a final polished pass rather than quick drafts', supportsLastFrame: true, imageFieldName: 'first_frame_url', resolutionClass: 'both' },
];
app.get('/api/video-models', (req, res) => {
  res.json({ models: VIDEO_MODELS.map(m => ({ id: m.id, label: m.label, costUsd: m.costUsd, blurb: m.blurb, supportsLastFrame: !!m.supportsLastFrame, resolutionClass: m.resolutionClass })) });
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
app.post('/api/lipsync/start', requireAuth, async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { videoUrl, audioUrl, model, meta } = req.body || {};
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'videoUrl and audioUrl are both required.' });
  }
  const matched = LIPSYNC_MODELS.find(m => m.id === model) || LIPSYNC_MODELS[0];
  if (!(await checkUserCanAfford(req, res, matched.id))) return;
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
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(), userId: req.user.id,
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
app.post('/api/photo-lipsync/start', requireAuth, async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { imageUrl, audioUrl, model, meta } = req.body || {};
  if (!imageUrl || !audioUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'imageUrl and audioUrl are both required.' });
  }
  const matched = PHOTO_LIPSYNC_MODELS.find(m => m.id === model) || PHOTO_LIPSYNC_MODELS[0];
  if (!(await checkUserCanAfford(req, res, matched.id))) return;
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
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(), userId: req.user.id,
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

// ---- photo + reference-performance-video -> new video (real "motion capture" style) ----
// Model id and field names confirmed directly from a literal docs.kie.ai curl example for
// this exact model (not inferred): kling-3.0/motion-control, with prompt/input_urls
// (character image)/video_urls (performance reference)/character_orientation/mode. Both
// list entries are the same real model, just a different mode value (720p="Standard",
// cheaper; 1080p="Pro", pricier) — mirrors the Volcengine lite/basic pattern used earlier.
// character_orientation is fixed to 'video' (not exposed as a choice) — switched from an
// initial 'image' after a live test with 'video' succeeded via the KIE playground and
// 'image' had not been directly confirmed working.
const MOTION_CONTROL_MODELS = [
  { id: 'kling-3.0/motion-control-standard', label: 'Kling Motion Control (Standard)', costUsd: 0.35, blurb: 'Transfers a real performance (motion, expression, timing) from your reference video onto the shot — not just lip movement', kieMode: '720p' },
  { id: 'kling-3.0/motion-control-pro', label: 'Kling Motion Control (Pro)', costUsd: 0.70, blurb: 'Same transfer, higher-resolution output', kieMode: '1080p' },
];
app.get('/api/motion-control-models', (req, res) => {
  res.json({ models: MOTION_CONTROL_MODELS.map(m => ({ id: m.id, label: m.label, costUsd: m.costUsd, blurb: m.blurb })) });
});

const ALL_MODEL_CATALOGS = [MODELS, VIDEO_MODELS, LIPSYNC_MODELS, PHOTO_LIPSYNC_MODELS, MOTION_CONTROL_MODELS];
function findModelCostUsd(modelId) {
  for (const catalog of ALL_MODEL_CATALOGS) {
    const found = catalog.find(m => m.id === modelId);
    if (found && found.costUsd) return found.costUsd;
  }
  return null;
}
// Stage 6 — real per-generation deduction. Rounds UP (a user should never be able to start
// a generation their balance can't quite cover) and never lets a balance go below 0 even if
// something about the timing was imperfect.
async function deductTokensForTask(userId, modelId) {
  if (!pool || !userId) return;
  const costUsd = findModelCostUsd(modelId);
  if (!costUsd) return; // unknown model — nothing sensible to deduct
  const costCredits = Math.ceil(costUsd / KIE_CREDIT_USD);
  try {
    await pool.query(
      'UPDATE users SET tokens = GREATEST(0, tokens - $1) WHERE id = $2 AND is_admin = false',
      [costCredits, userId]
    );
  } catch (err) {
    console.error('[server] could not deduct tokens for user ' + userId + ':', err);
  }
}
// Pre-generation check — called by every /api/*/start endpoint before it ever talks to KIE.
// Admins are exempt entirely (their balance IS the real KIE account, not a ledger to check).
// The admin's real personal balance — his actual KIE credits minus everything currently
// promised to users (their live token sum). This is what HE has left for his own
// generations, distinct from the raw KIE number, which includes tokens that aren't really
// his to spend.
async function getPersonalBalanceCredits() {
  const [kieCredits, sumResult] = await Promise.all([
    fetchKieCreditsRaw(),
    pool.query('SELECT COALESCE(SUM(tokens), 0) AS total FROM users WHERE is_admin = false'),
  ]);
  const promised = Number(sumResult.rows[0].total);
  return { kieCredits, promised, personalBalance: kieCredits - promised };
}
async function checkUserCanAfford(req, res, modelId) {
  if (!req.user) return true;
  const costUsd = findModelCostUsd(modelId);
  if (!costUsd) return true; // unknown cost — don't block on something we can't evaluate
  const costCredits = Math.ceil(costUsd / KIE_CREDIT_USD);
  try {
    let balance;
    if (req.user.is_admin) {
      // Admin's own generations now really do get blocked once his PERSONAL balance (KIE
      // minus what's promised to users) runs low — not exempt anymore, per the user's
      // explicit request that this actually protect him, not just display a number.
      const p = await getPersonalBalanceCredits();
      balance = p.personalBalance;
    } else {
      const result = await pool.query('SELECT tokens FROM users WHERE id = $1', [req.user.id]);
      balance = result.rows.length ? result.rows[0].tokens : 0;
    }
    if (balance < costCredits) {
      res.status(400).json({
        error: 'insufficient_balance',
        message: `Not enough tokens — this needs ${costCredits}, your balance is ${balance}.`,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[server] balance check failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not verify your balance.' });
    return false;
  }
}

// Re-hosts a file we already have in memory directly on KIE's OWN storage (their File
// Stream Upload API), instead of giving KIE's model backends a URL pointing back at our
// own server. This is the real fix for Motion Control's persistent failures — comparing
// the user's own successful KIE-playground upload against ours showed THEIR flow uploads
// straight to KIE's storage first, while ours made KIE fetch from an arbitrary third-party
// (our) server — which their own docs note has a 30s fetch timeout and is apparently
// unreliable for at least this model's backend, even though the file itself was always fine.
async function uploadToKieFileHost(buffer, mime, fileName){
  if (!KIE_API_KEY) throw new Error('KIE_API_KEY is not set.');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), fileName);
  form.append('uploadPath', 'motion-control');
  const res = await fetch('https://kieai.redpandaai.co/api/file-stream-upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success || !data.data || !data.data.downloadUrl) {
    throw new Error((data && data.msg) || ('KIE file upload failed (HTTP ' + res.status + ').'));
  }
  return data.data.downloadUrl;
}
app.post('/api/motion-control/start', requireAuth, async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { imageUrl, videoUrl, prompt, model, meta } = req.body || {};
  if (!imageUrl || !videoUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'imageUrl and videoUrl are both required.' });
  }
  const matched = MOTION_CONTROL_MODELS.find(m => m.id === model) || MOTION_CONTROL_MODELS[0];
  if (!(await checkUserCanAfford(req, res, matched.id))) return;

  let kieImageUrl, kieVideoUrl;
  try {
    // Both incoming URLs point at our own /api/reference-image/:id — pull the id out and
    // grab the buffer straight from memory rather than doing an HTTP round-trip to ourselves.
    const imgId = imageUrl.split('/api/reference-image/')[1];
    const vidId = videoUrl.split('/api/reference-image/')[1];
    const imgEntry = imgId && referenceImages.get(imgId);
    const vidEntry = vidId && referenceImages.get(vidId);
    if (!imgEntry || !vidEntry) throw new Error('Could not find the uploaded image/video to re-host on KIE.');
    [kieImageUrl, kieVideoUrl] = await Promise.all([
      uploadToKieFileHost(imgEntry.buffer, imgEntry.mime, 'shot.png'),
      uploadToKieFileHost(vidEntry.buffer, vidEntry.mime, 'reference.mp4'),
    ]);
  } catch (err) {
    console.error('[server] could not re-host files on KIE for motion-control:', err);
    return res.status(502).json({ error: 'provider_error', message: 'Could not upload the image/video to KIE: ' + String(err && err.message || err) });
  }

  const input = {
    prompt: prompt || '',
    input_urls: [kieImageUrl],
    video_urls: [kieVideoUrl],
    character_orientation: 'video',
    mode: matched.kieMode,
  };
  const callBackUrl = PUBLIC_URL ? PUBLIC_URL + '/api/webhook/kie' : undefined;

  try {
    const body = { model: 'kling-3.0/motion-control', input };
    if (callBackUrl) body.callBackUrl = callBackUrl;
    const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json().catch(() => null);
    console.log('[server] create motion-control task (' + matched.id + '):', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    tasks.set(taskId, {
      status: 'pending', imageUrl: null, message: null, model: matched.id, prompt: '', isVideo: true,
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(), userId: req.user.id,
    });
    if (!callBackUrl) {
      console.warn('[server] no PUBLIC_URL known — this task will rely entirely on the polling fallback.');
    }
    return res.json({ taskId });
  } catch (err) {
    console.error('[server] /api/motion-control/start failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- KIE.ai credit balance (for the small indicator in the corner of the UI) ----
const KIE_CREDIT_USD = 0.005; // KIE's own published rate — see docs.kie.ai
// Shared by /api/kie-credits and the admin panel's "don't promise more tokens than the
// real KIE balance" hard limit — one fetch implementation, not two copies that could drift.
async function fetchKieCreditsRaw() {
  const creditRes = await fetch(`${KIE_BASE}/api/v1/chat/credit`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
  });
  const data = await creditRes.json().catch(() => null);
  if (!creditRes.ok || !data || typeof data.data !== 'number') {
    throw new Error((data && data.msg) || ('KIE.ai rejected the request (HTTP ' + creditRes.status + ').'));
  }
  return data.data;
}
app.get('/api/my-balance', requireAuth, async (req, res) => {
  try {
    let credits;
    let personal = null;
    if (req.user.is_admin) {
      if (!KIE_API_KEY) return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
      const p = await getPersonalBalanceCredits();
      credits = p.kieCredits;
      personal = p.personalBalance;
    } else {
      // Fresh from the DB, not the value from login time — this is meant to reflect real
      // spending as it happens (stage 6), not a number that goes stale the moment you log in.
      const result = await pool.query('SELECT tokens FROM users WHERE id = $1', [req.user.id]);
      credits = result.rows.length ? result.rows[0].tokens : 0;
    }
    const cheapestModel = MODELS.reduce((min, m) => (m.costUsd && (!min || m.costUsd < min.costUsd)) ? m : min, null);
    const usd = credits * KIE_CREDIT_USD;
    const imagesRemaining = cheapestModel ? Math.floor(usd / cheapestModel.costUsd) : null;
    const out = { credits, usd, imagesRemaining, isAdmin: req.user.is_admin };
    if (personal !== null) {
      out.personalBalance = personal;
      out.personalUsd = personal * KIE_CREDIT_USD;
      out.personalImagesRemaining = cheapestModel ? Math.floor(out.personalUsd / cheapestModel.costUsd) : null;
    }
    res.json(out);
  } catch (err) {
    console.error('[server] /api/my-balance failed:', err);
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

app.get('/api/kie-credits', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  try {
    const credits = await fetchKieCreditsRaw();
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

// Moves a video's mp4 metadata (moov atom) to the front of the file — needed for a backend
// that fetches the file BY URL (our case) rather than receiving a direct upload, since some
// can't parse the file structure without it up front. Done here with a REAL ffmpeg binary,
// not the browser's ffmpeg.wasm build — that build has a confirmed, reproducible crash
// ("Aborted()") in its own internal two-pass moov-relocation mechanism, regardless of file
// size or how the command is structured, so this step was moved server-side entirely.
async function remuxFaststart(buffer){
  if(!ffmpegPath) throw new Error('ffmpeg-static is not available on this deployment.');
  const tmpDir = os.tmpdir();
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const inputPath = path.join(tmpDir, 'faststart_in_' + tag + '.mp4');
  const outputPath = path.join(tmpDir, 'faststart_out_' + tag + '.mp4');
  try{
    await fs.writeFile(inputPath, buffer);
    await execFileAsync(ffmpegPath, ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    fs.unlink(inputPath).catch(()=>{});
    fs.unlink(outputPath).catch(()=>{});
  }
}
app.post('/api/upload-reference-image', async (req, res) => {
  if(!PUBLIC_URL){
    return res.status(503).json({ error: 'not_configured', message: 'No public URL detected for this deployment — KIE can\'t fetch a reference image without one.' });
  }
  const { dataUrl, skipRemux } = req.body || {};
  if(!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf('data:')!==0){
    return res.status(400).json({ error: 'bad_request', message: 'dataUrl is required.' });
  }
  try{
    const commaIdx = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, commaIdx);
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    let buffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
    if(mime.indexOf('video/')===0 && !skipRemux){
      try{
        buffer = await remuxFaststart(buffer);
      } catch(remuxErr){
        console.warn('[server] faststart remux failed, uploading the original file as-is:', remuxErr);
      }
    }
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
app.post('/api/generate-image/start', requireAuth, async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { prompt, width, height, model, meta, referenceImageUrl } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'prompt is required.' });
  }
  const modelId = (MODELS.find(m => m.id === model) || MODELS[0]).id;
  if (!(await checkUserCanAfford(req, res, modelId))) return;
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
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(), userId: req.user.id,
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
function buildVideoInputFor(modelId, imageUrl, prompt, duration, lastFrameImageUrl, resolution, aspectRatio) {
  const model = VIDEO_MODELS.find(m => m.id === modelId);
  if (model && model.imageFieldName === 'first_frame_url') {
    const input = { prompt, first_frame_url: imageUrl, duration: String(duration || 5) };
    if (lastFrameImageUrl) input.last_frame_url = lastFrameImageUrl;
    // Seedance: resolution and aspect_ratio are two genuinely separate explicit fields.
    if (resolution) input.resolution = resolution;
    if (aspectRatio) input.aspect_ratio = aspectRatio;
    return input;
  }
  const input = {
    prompt,
    image_url: imageUrl,
    duration: String(duration || 5),
    negative_prompt: 'blurry, distorted, low quality, extra limbs, morphing, flickering',
    cfg_scale: 0.5,
  };
  // Kling: resolution is fixed by which specific model id you picked (Standard=720p,
  // Pro/Master=1080p always) — there's no resolution field to send. Only aspect_ratio is
  // ever adjustable; omitting it lets Kling auto-match the input image's own shape.
  if (aspectRatio) input.aspect_ratio = aspectRatio;
  return input;
}
app.post('/api/generate-video/start', requireAuth, async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { prompt, imageUrl, lastFrameImageUrl, duration, model, resolution, aspectRatio, meta } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'prompt is required.' });
  }
  if (!imageUrl) {
    return res.status(400).json({ error: 'bad_request', message: 'imageUrl is required — video generation animates an already-generated shot image.' });
  }
  const modelId = (VIDEO_MODELS.find(m => m.id === model) || VIDEO_MODELS[0]).id;
  if (!(await checkUserCanAfford(req, res, modelId))) return;
  const input = buildVideoInputFor(modelId, imageUrl, prompt, duration, lastFrameImageUrl, resolution, aspectRatio);
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
      meta: meta || {}, createdAt: Date.now(), updatedAt: Date.now(), userId: req.user.id,
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
app.post('/api/webhook/kie', async (req, res) => {
  const body = req.body || {};
  console.log('[server] webhook received:', JSON.stringify(body));
  const d = body.data || body;
  const taskId = d.taskId || body.taskId;
  if (!taskId) {
    console.warn('[server] webhook payload had no recognizable taskId — ignoring.');
    return res.status(200).json({ ok: true }); // still 200 so KIE doesn't retry forever
  }
  await applyTaskResult(taskId, d);
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

async function applyTaskResult(taskId, d) {
  const existing = tasks.get(taskId) || { meta: {}, createdAt: Date.now() };
  const state = (d.state || '').toLowerCase();
  const flag = Number(d.successFlag);
  const isSuccess = state === 'success' || flag === 1;
  const isFailed = state === 'fail' || state === 'failed' || flag === 2 || !!d.failMsg || !!d.errorMessage;
  const resultUrl = extractResultUrl(d);

  if (isSuccess && resultUrl) {
    tasks.set(taskId, { ...existing, status: 'success', imageUrl: resultUrl, updatedAt: Date.now() });
    console.log('[server] task ' + taskId + ' -> success');
    // Deduct exactly once per task, no matter how many times a webhook or poll re-confirms
    // the same success (KIE's own webhook delivery can legitimately retry/duplicate).
    if (!existing.tokensDeducted && existing.userId) {
      tasks.set(taskId, { ...tasks.get(taskId), tokensDeducted: true });
      await deductTokensForTask(existing.userId, existing.model);
    }
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
      if (pollData && pollData.data) await applyTaskResult(taskId, pollData.data);
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
  initDb();
});
