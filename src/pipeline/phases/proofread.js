const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { chapterFiles, wordCount } = require('../manuscript');

// Mechanical final pass (typos, spacing, obvious slips) on the cheapest
// model in the table. Runs per-chapter so it stays resumable.
async function run(job) {
  const files = chapterFiles(job.id);
  jobStore.appendLog(job.id, `Proofread: финальная вычитка ${files.length} глав`);

  for (const file of files) {
    const original = jobStore.readFile(job.id, `manuscript/${file}`);
    const { text, model } = await chatComplete({
      phase: 'proofread',
      system: 'Вычитай текст: орфография, пунктуация, опечатки. Не меняй сюжет и стиль.',
      prompt: original,
      targetWords: wordCount(original),
    });
    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.appendLog(job.id, `Proofread: ${file} готова (модель ${model})`);
  }

  return { proofread: files.length };
}

module.exports = { run };
