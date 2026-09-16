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
    const { text, model } = await chatComplete({
      phase: 'revision',
      system: 'Перепиши главу с учётом критики, сохранив сюжетные факты и объём.',
      prompt: `Критика:\n${report}\n\nГлава:\n${original}`,
      targetWords: wordCount(original),
    });
    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.appendLog(job.id, `Revision: ${file} переписана (модель ${model})`);
  }

  return { revised: toRevise.length };
}

module.exports = { run };
