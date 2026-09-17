const emptySection = document.getElementById('emptySection');
const statusSection = document.getElementById('statusSection');
const statusTitle = document.getElementById('statusTitle');
const progressBar = document.getElementById('progressBar');
const phaseLabel = document.getElementById('phaseLabel');
const chapterProgress = document.getElementById('chapterProgress');
const downloadBox = document.getElementById('downloadBox');
const downloadLink = document.getElementById('downloadLink');
const batchesBox = document.getElementById('batchesBox');
const batchesList = document.getElementById('batchesList');
const confirmBox = document.getElementById('confirmBox');
const costEstimateText = document.getElementById('costEstimateText');
const confirmBtn = document.getElementById('confirmBtn');
const cancelBtn = document.getElementById('cancelBtn');
const errorBox = document.getElementById('errorBox');
const retryBtn = document.getElementById('retryBtn');
const logPanel = document.getElementById('logPanel');
const dryRunBanner = document.getElementById('dryRunBanner');
const creditsLine = document.getElementById('creditsLine');

let currentJobId = null;

async function init() {
  refreshCredits();
  setInterval(refreshCredits, 60000);

  try {
    const status = await fetch('/api/status').then((r) => r.json());
    if (status.dryRun) {
      dryRunBanner.textContent = 'Режим DRY RUN: kie.ai не вызывается, используются заглушки — кредиты не тратятся.';
      dryRunBanner.classList.remove('hidden');
    }
  } catch {}

  const jobs = await fetch('/api/jobs').then((r) => r.json()).catch(() => []);
  if (jobs.length === 0) {
    emptySection.classList.remove('hidden');
    return;
  }
  showStatus(jobs[0].id); // listJobs() is sorted newest-first
}

async function refreshCredits() {
  try {
    const data = await fetch('/api/kie-balance').then((r) => r.json());
    if (!data.available) {
      creditsLine.textContent = data.error ? `Баланс kie.ai: ошибка (${data.error})` : 'Баланс kie.ai: —';
    } else {
      creditsLine.textContent = `Баланс kie.ai: ${data.credits} кредитов`;
    }
  } catch {
    creditsLine.textContent = 'Баланс kie.ai: недоступен';
  }
}

function showStatus(jobId) {
  currentJobId = jobId;
  emptySection.classList.add('hidden');
  statusSection.classList.remove('hidden');
  logPanel.textContent = '';

  const es = new EventSource(`/api/jobs/${jobId}/events`);
  es.addEventListener('log', (e) => {
    const line = JSON.parse(e.data);
    logPanel.textContent += line + '\n';
    logPanel.scrollTop = logPanel.scrollHeight;
  });
  es.addEventListener('state', (e) => {
    const job = JSON.parse(e.data);
    renderState(job);
    if (['done', 'error', 'cancelled'].includes(job.status)) {
      es.close();
    }
  });
}

function renderState(job) {
  statusTitle.textContent = `${job.input.game} — ${job.input.style}`;
  progressBar.style.width = `${job.progressPercent || 0}%`;

  const batchInfo = job.totalBatches
    ? ` (блок ${Math.min(job.currentBatch + 1, job.totalBatches)} из ${job.totalBatches})`
    : '';
  phaseLabel.textContent = job.phaseLabel ? `Этап: ${job.phaseLabel}${batchInfo}` : '—';
  chapterProgress.textContent = job.chaptersTotal
    ? `Глав написано: ${job.chaptersWritten || 0} / ${job.chaptersTotal}`
    : '';

  if (job.status === 'awaiting_confirmation' && job.costEstimate) {
    const e = job.costEstimate;
    const chapters = e.batchChapters ?? e.chapterCount;
    const words = e.batchWords ?? e.manuscriptWords;
    const label = e.batchChapters ? 'этот блок' : 'вся книга (ориентировочно)';
    costEstimateText.textContent =
      `Примерная стоимость (${label}): $${e.lowUsd}–$${e.highUsd} (~${e.lowCredits}–${e.highCredits} кредитов kie.ai), ` +
      `${chapters} глав, ~${words.toLocaleString('ru-RU')} слов.`;
    confirmBox.classList.remove('hidden');
  } else {
    confirmBox.classList.add('hidden');
  }

  if (job.status === 'done' && job.input.mode === 'sample') {
    downloadBox.classList.remove('hidden');
    downloadLink.href = `/api/jobs/${job.id}/download`;
  } else {
    downloadBox.classList.add('hidden');
  }

  if (job.batches && job.batches.length) {
    batchesBox.classList.remove('hidden');
    batchesList.innerHTML = job.batches
      .map(
        (b, i) =>
          `<li><a href="/api/jobs/${job.id}/download/${i}">Главы ${b.fromChapter}-${b.toChapter}</a>` +
          `${b.emailSent ? ' · отправлено на почту' : ''}</li>`
      )
      .join('');
  } else {
    batchesBox.classList.add('hidden');
  }

  if (job.status === 'error') {
    errorBox.textContent = `Ошибка: ${job.error}`;
    errorBox.classList.remove('hidden');
    retryBtn.classList.remove('hidden');
  } else if (job.status === 'cancelled') {
    errorBox.textContent = 'Запуск отменён.';
    errorBox.classList.remove('hidden');
    retryBtn.classList.add('hidden');
  } else {
    errorBox.classList.add('hidden');
    retryBtn.classList.add('hidden');
  }
}

retryBtn.addEventListener('click', async () => {
  retryBtn.disabled = true;
  await fetch(`/api/jobs/${currentJobId}/retry`, { method: 'POST' });
  retryBtn.disabled = false;
  showStatus(currentJobId); // reopen the log/status stream, closed when it errored
});

confirmBtn.addEventListener('click', async () => {
  confirmBtn.disabled = true;
  await fetch(`/api/jobs/${currentJobId}/confirm`, { method: 'POST' });
  confirmBtn.disabled = false;
});

cancelBtn.addEventListener('click', async () => {
  await fetch(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
  location.reload();
});

init();
