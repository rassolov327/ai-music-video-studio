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

app.post('/api/generate-image', async (req, res) => {
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
    const taskId = createData && createData.data && createData.data.taskId;
    if (!createRes.ok || !taskId) {
      return res.status(502).json({
        error: 'provider_error',
        message: (createData && createData.msg) || ('KIE.ai rejected the request (HTTP ' + createRes.status + ').'),
      });
    }

    // Poll for completion — simpler and more reliable here than standing up a public
    // callback URL just for this. 2.5s between checks, ~90s total budget.
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2500));
      const pollRes = await fetch(`${KIE_BASE}/api/v1/gpt4o-image/record-info?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      });
      const pollData = await pollRes.json().catch(() => null);
      const d = (pollData && pollData.data) || {};
      if (d.successFlag === 1 && d.response && d.response.result_urls && d.response.result_urls[0]) {
        return res.json({ imageUrl: d.response.result_urls[0], taskId });
      }
      if (d.errorCode || d.errorMessage) {
        return res.status(502).json({ error: 'generation_failed', message: d.errorMessage || 'Generation failed.', taskId });
      }
      // successFlag 0 (and no error) means still in progress — keep polling.
    }
    return res.status(504).json({ error: 'timeout', message: 'Generation took longer than expected.', taskId });
  } catch (err) {
    console.error('[server] /api/generate-image failed:', err);
    return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log('AI Music Video Studio server listening on port ' + PORT);
  console.log('KIE_API_KEY configured: ' + (!!KIE_API_KEY));
});
