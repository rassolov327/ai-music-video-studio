const jobStore = require('../jobStore');
const research = require('./phases/research');
const architecture = require('./phases/architecture');
const draft = require('./phases/draft');
const continuityAudit = require('./phases/continuityAudit');
const canonAudit = require('./phases/canonAudit');
const redTeam = require('./phases/redTeam');
const revision = require('./phases/revision');
const literaryEdit = require('./phases/literaryEdit');
const microAudits = require('./phases/microAudits');
const proofread = require('./phases/proofread');
const pdfPhase = require('./phases/pdf');
const { sendPdfEmail } = require('../email/send');

// Ordered pipeline. Each entry's `run` receives the job state and may throw
// to fail the whole job. State is persisted after every phase so a server
// restart resumes from the next phase (phases like draft/proofread are
// internally resumable per-chapter too).
const PHASES = [
  { key: 'research', label: 'Исследование', run: research.run },
  { key: 'architecture', label: 'Архитектура романа', run: architecture.run },
  { key: 'draft', label: 'Черновик', run: draft.run },
  { key: 'continuityAudit', label: 'Проверка непрерывности', run: continuityAudit.run },
  { key: 'canonAudit', label: 'Проверка канона', run: canonAudit.run },
  { key: 'redTeam1', label: 'Red team (1)', run: (job) => redTeam.run(job, { pass: 1 }) },
  { key: 'revision', label: 'Правки по критике', run: (job) => revision.run(job, { reportPath: 'quality/red_team_report.md' }) },
  { key: 'redTeam2', label: 'Red team (2)', run: (job) => redTeam.run(job, { pass: 2 }) },
  { key: 'literaryEdit', label: 'Литературная редактура', run: literaryEdit.run },
  { key: 'microAudits', label: 'Точечные проверки', run: microAudits.run },
  { key: 'proofread', label: 'Финальная вычитка', run: proofread.run },
  { key: 'pdf', label: 'Сборка PDF', run: pdfPhase.run },
  { key: 'deliver', label: 'Отправка', run: deliverPhase },
];

async function deliverPhase(job) {
  const to = job.input.email;
  if (to) {
    jobStore.appendLog(job.id, `Deliver: отправляю PDF на ${to}`);
    const result = await sendPdfEmail({
      to,
      subject: `Готово: роман по мотивам «${job.input.game}»`,
      text: 'Ваш роман готов. Файл во вложении, также доступен для скачивания на сайте.',
      attachmentPath: job.finalPdfPath,
    });
    jobStore.updateJob(job.id, { emailSent: result.sent });
    jobStore.appendLog(job.id, result.sent ? 'Deliver: письмо отправлено' : `Deliver: письмо пропущено (${result.reason})`);
  }
  return {};
}

const running = new Set();

async function runJob(jobId) {
  if (running.has(jobId)) return; // already in flight
  running.add(jobId);
  try {
    let job = jobStore.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    jobStore.updateJob(jobId, { status: 'running', error: null });
    jobStore.appendLog(jobId, `Запуск: игра="${job.input.game}", стиль="${job.input.style}", объём=${job.input.targetWords} слов`);

    const startIndex = job.phaseIndex || 0;
    for (let i = startIndex; i < PHASES.length; i++) {
      const phase = PHASES[i];
      job = jobStore.updateJob(jobId, {
        phaseIndex: i,
        phaseKey: phase.key,
        phaseLabel: phase.label,
        progressPercent: Math.round((i / PHASES.length) * 100),
      });
      jobStore.appendLog(jobId, `>>> Фаза: ${phase.label}`);
      await phase.run(job);
      job = jobStore.getJob(jobId);
    }

    jobStore.updateJob(jobId, { status: 'done', progressPercent: 100, phaseKey: 'done', phaseLabel: 'Готово' });
    jobStore.appendLog(jobId, 'Готово: роман завершён.');
  } catch (err) {
    jobStore.updateJob(jobId, { status: 'error', error: String((err && err.message) || err) });
    jobStore.appendLog(jobId, `ОШИБКА: ${(err && err.message) || err}`);
  } finally {
    running.delete(jobId);
  }
}

// Called on server startup to pick up any job that was mid-flight when the
// process last stopped (Railway redeploy, crash, etc).
function resumeUnfinishedJobs() {
  const jobs = jobStore.listJobs().filter((j) => j.status === 'running' || j.status === 'pending');
  for (const job of jobs) {
    jobStore.appendLog(job.id, 'Сервер перезапущен — возобновляю с последней завершённой фазы.');
    runJob(job.id);
  }
}

module.exports = { PHASES, runJob, resumeUnfinishedJobs };
