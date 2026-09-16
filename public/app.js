const emptySection = document.getElementById('emptySection');
const statusSection = document.getElementById('statusSection');
const statusTitle = document.getElementById('statusTitle');
const progressBar = document.getElementById('progressBar');
const phaseLabel = document.getElementById('phaseLabel');
const chapterProgress = document.getElementById('chapterProgress');
const downloadBox = document.getElementById('downloadBox');
const downloadLink = document.getElementById('downloadLink');
const confirmBox = document.getElementById('confirmBox');
const costEstimateText = document.getElementById('costEstimateText');
const confirmBtn = document.getElementById('confirmBtn');
const cancelBtn = document.getElementById('cancelBtn');
const errorBox = document.getElementById('errorBox');
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
  phaseLabel.textContent = job.phaseLabel ? `Этап: ${job.phaseLabel}` : '—';
  chapterProgress.textContent = job.chaptersTotal
    ? `Глав написано: ${job.chaptersWritten || 0} / ${job.chaptersTotal}`
    : '';

  if (job.status === 'awaiting_confirmation' && job.costEstimate) {
    const e = job.costEstimate;
    costEstimateText.textContent =
      `Примерная стоимость: $${e.lowUsd}–$${e.highUsd} (~${e.lowCredits}–${e.highCredits} кредитов kie.ai), ` +
      `${e.chapterCount} глав, ~${e.manuscriptWords.toLocaleString('ru-RU')} слов черновика.`;
    confirmBox.classList.remove('hidden');
  } else {
    confirmBox.classList.add('hidden');
  }

  if (job.status === 'done') {
    downloadBox.classList.remove('hidden');
    downloadLink.href = `/api/jobs/${job.id}/download`;
  } else {
    downloadBox.classList.add('hidden');
  }

  if (job.status === 'error') {
    errorBox.textContent = `Ошибка: ${job.error}`;
    errorBox.classList.remove('hidden');
  } else if (job.status === 'cancelled') {
    errorBox.textContent = 'Запуск отменён.';
    errorBox.classList.remove('hidden');
  } else {
    errorBox.classList.add('hidden');
  }
}

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
