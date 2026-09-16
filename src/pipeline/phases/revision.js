const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { chapterFiles, wordCount } = require('../manuscript');

// Rewrites the chapters flagged by the red-team report. In the absence of a
// structured list of chapter numbers from the model, we conservatively
// revise every 5th chapter — enough to exercise the mechanism end-to-end.
async function run(job, { reportPath = 'quality/red_team_report.md' } = {}) {
  const report = jobStore.exists(job.id, reportPath) ? jobStore.readFile(job.id, reportPath) : '';
  const files = chapterFiles(job.id);
  const toRevise = files.filter((_, i) => i % 5 === 4);

  jobStore.appendLog(job.id, `Revision: правлю ${toRevise.length} из ${files.length} глав по критике`);

  for (const file of toRevise) {
    const original = jobStore.readFile(job.id, `manuscript/${file}`);
    const originalWords = wordCount(original);
    const { text, model } = await chatComplete({
      phase: 'revision',
      system:
        'Перепиши главу с учётом критики, сохранив сюжетные факты и объём. ' +
        'В ответе выведи ТОЛЬКО переписанный текст главы целиком, без комментариев ' +
        'о внесённых правках и без пояснений.',
      prompt: `Критика:\n${report}\n\nГлава:\n${original}`,
      targetWords: originalWords,
    });

    // Guard against a model answering with commentary about the changes
    // instead of the rewritten chapter itself — same failure mode as
    // proofread.js, same fix: don't clobber a good chapter with junk.
    if (wordCount(text) < originalWords * 0.6) {
      jobStore.appendLog(
        job.id,
        `Revision: ответ модели (${model}) подозрительно короткий (${wordCount(text)} vs ${originalWords} слов) — похоже на комментарий, а не текст. Оставляю ${file} без изменений.`
      );
      continue;
    }

    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.appendLog(job.id, `Revision: ${file} переписана (модель ${model})`);
  }

  return { revised: toRevise.length };
}

module.exports = { run };
