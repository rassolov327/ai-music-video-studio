const express = require('express');
const path = require('path');
const jobStore = require('./jobStore');
const pipeline = require('./pipeline');
const { isDryRun, getCreditBalance } = require('./pipeline/kieClient');
const { estimateCost } = require('./pipeline/costEstimate');
const { smtpConfigured } = require('./email/send');

// Log-and-survive instead of letting Node crash the whole process (and
// silently drop any in-flight job) over one bad promise/exception.
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

const app = express();
app.use(express.json());

// --- Basic auth gate (only active if credentials are configured) ---
const APP_USER = process.env.APP_USER;
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_USER && APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (user === APP_USER && pass === APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Novel Factory"');
    res.status(401).send('Authentication required.');
  });
} else {
  console.warn('APP_USER/APP_PASSWORD не заданы — сайт открыт без пароля.');
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// --- API ---
const ACTIVE_STATUSES = ['awaiting_confirmation', 'running', 'pending'];

app.post('/api/jobs', (req, res) => {
  const { game, style, targetWords, language, email, mode } = req.body || {};
  if (!game || !style) {
    return res.status(400).json({ error: 'Нужно указать игру и стиль автора.' });
  }
  const active = jobStore.listJobs().find((j) => ACTIVE_STATUSES.includes(j.status));
  if (active) {
    return res.status(409).json({ error: 'Уже выполняется другая книга. Дождитесь завершения.', jobId: active.id });
  }

  const input = {
    game: String(game).trim(),
    style: String(style).trim(),
    targetWords: Number(targetWords) || 100000,
    language: language ? String(language).trim() : 'ru',
    email: email ? String(email).trim() : null,
    mode: mode === 'sample' ? 'sample' : 'full',
  };

  const job = jobStore.createJob(input);
  const costEstimate = estimateCost({ targetWords: input.targetWords, mode: input.mode });

  if (isDryRun()) {
    // Nothing real is spent — start immediately, no confirmation needed.
    jobStore.updateJob(job.id, { costEstimate });
    pipeline.runJob(job.id);
  } else {
    // Real kie.ai credits would be spent — wait for explicit confirmation.
    jobStore.updateJob(job.id, { status: 'awaiting_confirmation', costEstimate });
    jobStore.appendLog(job.id, `Оценка стоимости: ~$${costEstimate.lowUsd}–$${costEstimate.highUsd} (~${costEstimate.lowCredits}–${costEstimate.highCredits} кредитов kie.ai). Жду подтверждения.`);
  }

  res.json(jobStore.getJob(job.id));
});

app.post('/api/jobs/:id/confirm', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status !== 'awaiting_confirmation') {
    return res.status(409).json({ error: 'Эта книга не ждёт подтверждения.' });
  }
  jobStore.updateJob(job.id, { confirmed: true, status: 'pending' });
  jobStore.appendLog(job.id, 'Подтверждено: запускаю реальную генерацию через kie.ai.');
  pipeline.runJob(job.id);
  res.json(jobStore.getJob(job.id));
});

app.post('/api/jobs/:id/retry', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status !== 'error') {
    return res.status(409).json({ error: 'Повторить можно только книгу с ошибкой.' });
  }
  // Resumes from job.phaseIndex (the phase that failed), not from scratch —
  // already-confirmed spend isn't re-authorized, just continued.
  jobStore.updateJob(job.id, { status: 'pending', error: null });
  jobStore.appendLog(job.id, 'Повтор после ошибки — возобновляю с фазы, на которой остановились.');
  pipeline.runJob(job.id);
  res.json(jobStore.getJob(job.id));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status !== 'awaiting_confirmation') {
    return res.status(409).json({ error: 'Отменить можно только книгу, ожидающую подтверждения.' });
  }
  jobStore.updateJob(job.id, { status: 'cancelled' });
  jobStore.appendLog(job.id, 'Отменено пользователем до траты кредитов.');
  res.json(jobStore.getJob(job.id));
});

app.get('/api/jobs', (req, res) => {
  res.json(jobStore.listJobs());
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Replay existing log so a freshly opened tab sees history immediately.
  const history = jobStore.readLog(req.params.id);
  for (const line of history.split('\n').filter(Boolean)) {
    res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
  }
  res.write(`event: state\ndata: ${JSON.stringify(jobStore.getJob(req.params.id))}\n\n`);

  const onLog = (line) => res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
  const onState = (state) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  jobStore.bus.on(`log:${req.params.id}`, onLog);
  jobStore.bus.on(`state:${req.params.id}`, onState);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    jobStore.bus.off(`log:${req.params.id}`, onLog);
    jobStore.bus.off(`state:${req.params.id}`, onState);
  });
});

app.get('/api/jobs/:id/download', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job || !job.finalPdfPath) return res.status(404).end();
  res.download(job.finalPdfPath, `${job.input.game} — роман.pdf`);
});

app.get('/api/status', (req, res) => {
  res.json({ dryRun: isDryRun(), emailConfigured: smtpConfigured() });
});

let balanceCache = { at: 0, data: null };
app.get('/api/kie-balance', async (req, res) => {
  if (Date.now() - balanceCache.at < 30000 && balanceCache.data) {
    return res.json(balanceCache.data);
  }
  const data = await getCreditBalance().catch((err) => ({ available: false, error: String(err.message || err) }));
  balanceCache = { at: Date.now(), data };
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Novel factory listening on ${PORT} (dryRun=${isDryRun()})`);
  pipeline.resumeUnfinishedJobs();
});

module.exports = app;
