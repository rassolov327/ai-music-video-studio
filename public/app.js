const formSection = document.getElementById('formSection');
const statusSection = document.getElementById('statusSection');
const jobForm = document.getElementById('jobForm');
const formError = document.getElementById('formError');
const statusTitle = document.getElementById('statusTitle');
const progressBar = document.getElementById('progressBar');
const phaseLabel = document.getElementById('phaseLabel');
const chapterProgress = document.getElementById('chapterProgress');
const downloadBox = document.getElementById('downloadBox');
const downloadLink = document.getElementById('downloadLink');
const errorBox = document.getElementById('errorBox');
const logPanel = document.getElementById('logPanel');
const dryRunBanner = document.getElementById('dryRunBanner');

const JOB_KEY = 'novelFactoryJobId';

async function init() {
  try {
    const status = await fetch('/api/status').then((r) => r.json());
    if (status.dryRun) {
      dryRunBanner.textContent = 'Режим DRY RUN: kie.ai не вызывается, используются заглушки — кредиты не тратятся.';
      dryRunBanner.classList.remove('hidden');
    }
  } catch {}

  const savedId = localStorage.getItem(JOB_KEY);
  if (savedId) {
    const job = await fetch(`/api/jobs/${savedId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (job) return showStatus(job.id);
  }

  const jobs = await fetch('/api/jobs').then((r) => r.json()).catch(() => []);
  const active = jobs.find((j) => j.status === 'running' || j.status === 'pending');
  if (active) return showStatus(active.id);
}

jobForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');
  const data = Object.fromEntries(new FormData(jobForm).entries());
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) {
    formError.textContent = body.error || 'Не удалось запустить.';
    formError.classList.remove('hidden');
    return;
  }
  showStatus(body.id);
});

function phaseIndexTotal() {
  return 13; // keep in sync with server PHASES length, for display only
}

function showStatus(jobId) {
  localStorage.setItem(JOB_KEY, jobId);
  formSection.classList.add('hidden');
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
    if (job.status === 'done' || job.status === 'error') {
      es.close();
    }
  });
  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do.
  };
}

function renderState(job) {
  statusTitle.textContent = `${job.input.game} — ${job.input.style}`;
  progressBar.style.width = `${job.progressPercent || 0}%`;
  phaseLabel.textContent = job.phaseLabel ? `Этап: ${job.phaseLabel}` : '—';
  chapterProgress.textContent = job.chaptersTotal
    ? `Глав написано: ${job.chaptersWritten || 0} / ${job.chaptersTotal}`
    : '';

  if (job.status === 'done') {
    downloadBox.classList.remove('hidden');
    downloadLink.href = `/api/jobs/${job.id}/download`;
  }
  if (job.status === 'error') {
    errorBox.textContent = `Ошибка: ${job.error}`;
    errorBox.classList.remove('hidden');
  } else {
    errorBox.classList.add('hidden');
  }
}

init();
