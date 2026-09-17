const jobStore = require('../jobStore');
const { isDryRun } = require('./kieClient');
const { estimateBatchCost } = require('./costEstimate');
const research = require('./phases/research');
const architecture = require('./phases/architecture');
const { BATCH_CHAPTERS, CHAPTER_WORDS } = architecture;
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

// --- Sample mode: one throwaway preview chapter, no batching needed ---
const SAMPLE_PHASES = [
  { key: 'research', label: 'Исследование', run: research.run },
  { key: 'architecture', label: 'Архитектура (глава 1)', run: architecture.run },
  { key: 'draft', label: 'Черновик главы 1', run: (job) => draft.run(job, { fromChapter: 1, toChapter: 1 }) },
  { key: 'proofread', label: 'Финальная вычитка', run: (job) => proofread.run(job, { fromChapter: 1, toChapter: 1 }) },
  { key: 'pdf', label: 'Сборка PDF', run: (job) => pdfPhase.run(job, { fromChapter: 1, toChapter: 1, isSample: true }) },
  { key: 'deliver', label: 'Отправка', run: (job) => deliverSample(job) },
];

// --- Full mode: plan once, then write/check/deliver a batch at a time ---
const SETUP_PHASES = [
  { key: 'research', label: 'Исследование', run: research.run },
  { key: 'architecture', label: 'Архитектура романа', run: architecture.run },
];

function batchPhases(fromChapter, toChapter) {
  return [
    { key: 'draft', label: `Черновик (главы ${fromChapter}-${toChapter})`, run: (job) => draft.run(job, { fromChapter, toChapter }) },
    { key: 'continuityAudit', label: 'Проверка непрерывности блока', run: (job) => continuityAudit.run(job, { fromChapter, toChapter }) },
    { key: 'canonAudit', label: 'Проверка канона блока', run: (job) => canonAudit.run(job, { fromChapter, toChapter }) },
    { key: 'redTeam', label: 'Red team блока', run: (job) => redTeam.run(job, { fromChapter, toChapter }) },
    { key: 'revision', label: 'Правки блока', run: (job) => revision.run(job, { fromChapter, toChapter }) },
    { key: 'literaryEdit', label: 'Литературная редактура блока', run: (job) => literaryEdit.run(job, { fromChapter, toChapter }) },
    { key: 'microAudits', label: 'Точечные проверки блока', run: (job) => microAudits.run(job, { fromChapter, toChapter }) },
    { key: 'proofread', label: 'Вычитка блока', run: (job) => proofread.run(job, { fromChapter, toChapter }) },
    { key: 'pdf', label: 'Сборка PDF блока', run: (job) => pdfPhase.run(job, { fromChapter, toChapter, isSample: false }) },
    { key: 'deliverBatch', label: 'Отправка блока', run: (job) => deliverBatch(job) },
  ];
}

function batchRange(currentBatch, totalChapters) {
  const fromChapter = currentBatch * BATCH_CHAPTERS + 1;
  const toChapter = Math.min(totalChapters, fromChapter + BATCH_CHAPTERS - 1);
  return { fromChapter, toChapter };
}

async function deliverSample(job) {
  if (job.input.email) {
    jobStore.appendLog(job.id, `Deliver: отправляю PDF на ${job.input.email}`);
    const result = await sendPdfEmail({
      to: job.input.email,
      subject: `Готово: ознакомительный фрагмент «${job.input.game}»`,
      text: 'Фрагмент готов. Файл во вложении, также доступен для скачивания на сайте.',
      attachmentPath: job.finalPdfPath,
    });
    jobStore.updateJob(job.id, { emailSent: result.sent });
    jobStore.appendLog(job.id, result.sent ? 'Deliver: письмо отправлено' : `Deliver: письмо пропущено (${result.reason})`);
  }
  return {};
}

async function deliverBatch(job) {
  const batches = [...(job.batches || [])];
  const last = batches[batches.length - 1];
  if (last && job.input.email) {
    jobStore.appendLog(job.id, `Deliver: отправляю главы ${last.fromChapter}-${last.toChapter} на ${job.input.email}`);
    const result = await sendPdfEmail({
      to: job.input.email,
      subject: `Готовы главы ${last.fromChapter}-${last.toChapter}: «${job.input.game}»`,
      text: 'Очередной блок глав готов. Файл во вложении, также доступен для скачивания на сайте.',
      attachmentPath: last.pdfPath,
    });
    last.emailSent = result.sent;
    jobStore.updateJob(job.id, { batches });
    jobStore.appendLog(job.id, result.sent ? 'Deliver: письмо отправлено' : `Deliver: письмо пропущено (${result.reason})`);
  }
  return {};
}

const running = new Set();

function scheduleNextBatchConfirmation(jobId, nextBatch, totalChapters, totalBatches) {
  const { fromChapter, toChapter } = batchRange(nextBatch, totalChapters);
  const costEstimate = estimateBatchCost({
    batchChapters: toChapter - fromChapter + 1,
    chapterWords: CHAPTER_WORDS,
    isFirstBatch: nextBatch === 0,
    isLastBatch: nextBatch + 1 >= totalBatches,
  });
  jobStore.updateJob(jobId, {
    currentBatch: nextBatch,
    phaseIndex: 0,
    status: 'awaiting_confirmation',
    confirmed: false,
    costEstimate,
    progressPercent: Math.round((nextBatch / totalBatches) * 100),
  });
  jobStore.appendLog(
    jobId,
    `Следующий блок (главы ${fromChapter}-${toChapter} из ${totalChapters}): ` +
      `~$${costEstimate.lowUsd}–$${costEstimate.highUsd} (~${costEstimate.lowCredits}–${costEstimate.highCredits} кредитов). Жду подтверждения.`
  );
}

async function runPhaseList(jobId, phases) {
  let job = jobStore.getJob(jobId);
  const startIndex = job.phaseIndex || 0;
  for (let i = startIndex; i < phases.length; i++) {
    const phase = phases[i];
    job = jobStore.updateJob(jobId, {
      phaseIndex: i,
      phaseKey: phase.key,
      phaseLabel: phase.label,
    });
    jobStore.appendLog(jobId, `>>> Фаза: ${phase.label}`);
    await phase.run(job);
    job = jobStore.getJob(jobId);
  }
  return job;
}

async function runJob(jobId) {
  if (running.has(jobId)) return; // already in flight
  running.add(jobId);
  try {
    let job = jobStore.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Real (non-dry-run) generation spends real kie.ai credits and must be
    // explicitly confirmed first — for full-mode books, this check gates
    // BOTH the initial setup and every subsequent batch (confirmed resets
    // to false after each batch). Re-verified here (not just in the route)
    // so a server restart can never auto-resume an unconfirmed spend.
    if (!isDryRun() && !job.confirmed) {
      jobStore.appendLog(jobId, 'Запуск отклонён: требуется подтверждение траты кредитов.');
      return;
    }

    jobStore.updateJob(jobId, { status: 'running', error: null });

    if (job.input.mode === 'sample') {
      jobStore.appendLog(jobId, `Запуск (sample): игра="${job.input.game}", стиль="${job.input.style}"`);
      await runPhaseList(jobId, SAMPLE_PHASES);
      jobStore.updateJob(jobId, { status: 'done', progressPercent: 100, phaseKey: 'done', phaseLabel: 'Готово' });
      jobStore.appendLog(jobId, 'Готово: фрагмент завершён.');
      return;
    }

    // --- Full mode: plan once, then confirm+write one batch at a time.
    // In DRY_RUN, nothing costs anything, so the loop just keeps going
    // instead of stopping for a confirmation that would never arrive
    // (server.js never auto-confirms a dry-run job past its first call).
    for (;;) {
      job = jobStore.getJob(jobId);

      if (!job.totalChapters) {
        jobStore.appendLog(jobId, `Запуск: игра="${job.input.game}", стиль="${job.input.style}", объём=${job.input.targetWords} слов`);
        job = await runPhaseList(jobId, SETUP_PHASES);
        // architecture.run() has just set totalChapters/totalBatches/currentBatch=0.
        job = jobStore.updateJob(jobId, { phaseIndex: 0 });
      } else {
        const { fromChapter, toChapter } = batchRange(job.currentBatch, job.totalChapters);
        job = await runPhaseList(jobId, batchPhases(fromChapter, toChapter));

        if (job.currentBatch + 1 >= job.totalBatches) {
          jobStore.updateJob(jobId, { status: 'done', progressPercent: 100, phaseKey: 'done', phaseLabel: 'Готово' });
          jobStore.appendLog(jobId, 'Готово: все блоки написаны.');
          return;
        }
        job = jobStore.updateJob(jobId, { currentBatch: job.currentBatch + 1, phaseIndex: 0 });
      }

      // job.currentBatch now points at the batch that's ready to start next.
      if (isDryRun()) {
        continue; // nothing to confirm — keep writing straight through
      }
      // Every batch gets its own "how much will this cost" checkpoint,
      // including the first one right after setup — stop and wait.
      scheduleNextBatchConfirmation(jobId, job.currentBatch, job.totalChapters, job.totalBatches);
      return;
    }
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

module.exports = { runJob, resumeUnfinishedJobs, batchRange };
