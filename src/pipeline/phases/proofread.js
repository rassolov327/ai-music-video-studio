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
    const originalWords = wordCount(original);
    const { text, model } = await chatComplete({
      phase: 'proofread',
      system:
        'Вычитай художественный текст на опечатки, орфографию и пунктуацию. ' +
        'Не меняй сюжет, стиль и объём. В ответе выведи ТОЛЬКО исправленный текст целиком, ' +
        'без комментариев, без списка найденных ошибок, без пояснений — только сам текст главы.',
      prompt: original,
      targetWords: originalWords,
    });

    // A proofread pass should return prose of roughly the same length —
    // a model answering with commentary/a diff instead of the corrected
    // text produces something much shorter. Guard against silently
    // clobbering a good chapter with that.
    if (wordCount(text) < originalWords * 0.6) {
      jobStore.appendLog(
        job.id,
        `Proofread: ответ модели (${model}) подозрительно короткий (${wordCount(text)} vs ${originalWords} слов) — похоже на комментарий, а не текст. Оставляю ${file} без изменений.`
      );
      continue;
    }

    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.appendLog(job.id, `Proofread: ${file} готова (модель ${model})`);
  }

  return { proofread: files.length };
}

module.exports = { run };
