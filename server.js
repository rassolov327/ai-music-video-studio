// AI Music Video Studio — server
// Replaces the previous Caddy static-file setup. Does two things:
//   1. Serves the app (index.html, styles.css, js/) exactly like Caddy did, with the same
//      permissive-but-safe CSP headers (blob: included — see the img/media-src bugs we
//      chased down earlier in this project).
//   2. Exposes POST /api/generate-image, which proxies to KIE.ai's GPT-Image-1 API using
//      an API key that lives ONLY here on the server (as an env var) — never sent to or
//      readable by the browser. The browser only ever talks to this same-origin endpoint.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

const KIE_API_KEY = process.env.KIE_API_KEY || '';
const KIE_BASE = 'https://api.kie.ai';

app.use(express.json({ limit: '1mb' }));

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

// ---- health check — lets you (or `curl`) confirm the key is actually configured ----
app.get('/api/health', (req, res) => {
  res.json({ ok: true, kieConfigured: !!KIE_API_KEY });
});

// ---- diagnostic only: shows EXACTLY what KIE's record-info endpoint returns for a given
// taskId, completely unmodified — no guessing at field names, just the raw truth. Use this
// with a taskId that KIE's own dashboard already shows as "успешно" (successful) to see
// precisely what a real completed response looks like.
app.get('/api/debug/task/:taskId', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  try {
    const pollRes = await fetch(`${KIE_BASE}/api/v1/gpt4o-image/record-info?taskId=${encodeURIComponent(req.params.taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    const text = await pollRes.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(pollRes.status).send(text);
  } catch (err) {
    res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- paid image generation, proxied through KIE.ai's GPT-Image-1 ----
// KIE's gpt4o-image model only accepts a few fixed aspect ratios, not arbitrary pixel
// sizes — pick the closest one to the project's actual width/height.
function closestKieSize(width, height) {
  const ratio = (width && height) ? width / height : 1;
  const options = [
    { size: '1:1', ratio: 1 },
    { size: '3:2', ratio: 3 / 2 },
    { size: '2:3', ratio: 2 / 3 },
  ];
  let best = options[0], bestDiff = Infinity;
  for (const o of options) {
    const diff = Math.abs(Math.log(ratio) - Math.log(o.ratio));
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  }
  return best.size;
}

// ---- start a generation task, return immediately (no waiting here) ----
app.post('/api/generate-image/start', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const { prompt, width, height } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'prompt is required.' });
  }
  const size = closestKieSize(width, height);

  try {
    const createRes = await fetch(`${KIE_BASE}/api/v1/gpt4o-image/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        size,
        isEnhance: false,
        uploadCn: false,
        enableFallback: true,
        fallbackModel: 'FLUX_MAX',
      }),
    });
    const createData = await createRes.json().catch(() => null);
    console.log('[server] create task response:', JSON.stringify(createData));
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }
    return res.json({ taskId });
  } catch (err) {
    console.error('[server] /api/generate-image/start failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---- check on a task — one lightweight poll per call, the browser calls this repeatedly ----
app.get('/api/generate-image/status', async (req, res) => {
  if (!KIE_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'KIE_API_KEY is not set on the server yet.' });
  }
  const taskId = req.query.taskId;
  if (!taskId) return res.status(400).json({ error: 'bad_request', message: 'taskId is required.' });

  try {
    const pollRes = await fetch(`${KIE_BASE}/api/v1/gpt4o-image/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    const pollData = await pollRes.json().catch(() => null);
    const d = (pollData && pollData.data) || {};
    console.log('[server] poll ' + taskId + ':', JSON.stringify(pollData));

    // KIE's docs show successFlag as a plain number in some examples and there's a
    // history in this project of "===" strict checks silently failing against fields
    // that come back as strings — coerce to Number defensively rather than guess again.
    const flag = Number(d.successFlag);
    // The docs also disagree with themselves on the result field's casing between two
    // different doc pages (result_urls vs resultUrls) — check both.
    const resultUrl = d.response && (
      (d.response.result_urls && d.response.result_urls[0]) ||
      (d.response.resultUrls && d.response.resultUrls[0])
    );
    if (flag === 1 && resultUrl) {
      return res.json({ status: 'success', imageUrl: resultUrl, taskId });
    }
    if (flag === 2 || d.errorCode || d.errorMessage) {
      return res.json({ status: 'failed', message: d.errorMessage || 'Generation failed.', taskId });
    }
    return res.json({ status: 'pending', kieStatus: d.status || null, progress: d.progress || null, taskId });
  } catch (err) {
    console.error('[server] /api/generate-image/status failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log('AI Music Video Studio server listening on port ' + PORT);
  console.log('KIE_API_KEY configured: ' + (!!KIE_API_KEY));
});
