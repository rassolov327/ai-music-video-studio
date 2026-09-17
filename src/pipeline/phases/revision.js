const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { chapterFileName, wordCount } = require('../manuscript');

// Revises every chapter in this batch against the batch's red-team report
// and any per-chapter consistency flags from draft.js. Batches are small
// (a handful of chapters), so revising all of them is cheap enough that we
// don't need to guess which specific chapter a critique was about.
async function run(job, { fromChapter, toChapter }) {
  const batchTag = String(job.currentBatch).padStart(2, '0');
  const redTeamPath = `quality/batch_${batchTag}_red_team.md`;
  const flagsPath = `quality/batch_${batchTag}_flags.md`;
  const report = jobStore.exists(job.id, redTeamPath) ? jobStore.readFile(job.id, redTeamPath) : '';
  const flags = jobStore.exists(job.id, flagsPath) ? jobStore.readFile(job.id, flagsPath) : '';

  if (!report.trim() && !flags.trim()) {
    jobStore.appendLog(job.id, 'Revision: замечаний нет, пропускаю правки блока');
    return { revised: 0 };
  }

  jobStore.appendLog(job.id, `Revision: правлю главы ${fromChapter}-${toChapter} по критике`);
  let revised = 0;

  for (let i = fromChapter; i <= toChapter; i++) {
    const file = chapterFileName(i);
    if (!jobStore.exists(job.id, `manuscript/${file}`)) continue;

    const original = jobStore.readFile(job.id, `manuscript/${file}`);
    const originalWords = wordCount(original);
    jobStore.appendLog(job.id, `Revision: переписываю главу ${i}`);
    const { text, model } = await chatComplete({
      phase: 'revision',
      system:
        'Перепиши главу с учётом критики и найденных нестыковок, сохранив сюжетные факты и объём. ' +
        'В ответе выведи ТОЛЬКО переписанный текст главы целиком, без комментариев ' +
        'о внесённых правках и без пояснений.',
      prompt: `Критика:\n${report}\n\nНайденные нестыковки:\n${flags}\n\nГлава ${i}:\n${original}`,
      targetWords: originalWords,
    });

    if (wordCount(text) < originalWords * 0.6) {
      jobStore.appendLog(
        job.id,
        `Revision: ответ модели (${model}) подозрительно короткий для главы ${i} — похоже на комментарий, а не текст. Оставляю без изменений.`
      );
      continue;
    }

    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.appendLog(job.id, `Revision: глава ${i} переписана (модель ${model})`);
    revised++;
  }

  return { revised };
}

module.exports = { run };
