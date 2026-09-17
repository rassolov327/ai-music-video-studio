const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readBatchManuscript } = require('../manuscript');

// Analysis-only pass: rhythm, dialogue, imagery, transitions, scoped to
// this batch. Recorded as a report rather than another rewrite pass —
// revision.js already handles targeted rewrites for this batch.
async function run(job, { fromChapter, toChapter }) {
  jobStore.appendLog(job.id, `Literary edit: оцениваю главы ${fromChapter}-${toChapter}`);
  const batchText = readBatchManuscript(job.id, fromChapter, toChapter);

  const { text, model } = await chatComplete({
    phase: 'literaryEdit',
    system:
      'Ты — литературный редактор. Оцени ритм предложений/абзацев/сцен, диалоги, ' +
      'плотность метафор, переходы. Дай конкретные рекомендации.',
    prompt: batchText,
    targetWords: 250,
  });

  jobStore.writeFile(job.id, `quality/batch_${String(job.currentBatch).padStart(2, '0')}_editorial.md`, text);
  jobStore.appendLog(job.id, `Literary edit: отчёт готов (модель ${model})`);
  return {};
}

module.exports = { run };
