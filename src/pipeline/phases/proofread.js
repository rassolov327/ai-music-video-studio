const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { chapterFileName, wordCount } = require('../manuscript');

// Mechanical final pass (typos, spacing, obvious slips) on this batch's
// chapters, on the cheapest model in the table.
async function run(job, { fromChapter, toChapter }) {
  jobStore.appendLog(job.id, `Proofread: финальная вычитка глав ${fromChapter}-${toChapter}`);

  for (let i = fromChapter; i <= toChapter; i++) {
    const file = chapterFileName(i);
    if (!jobStore.exists(job.id, `manuscript/${file}`)) continue;

    const original = jobStore.readFile(job.id, `manuscript/${file}`);
    const originalWords = wordCount(original);
    jobStore.appendLog(job.id, `Proofread: вычитываю главу ${i}`);

    // Best-effort: a chapter is already a complete, usable chapter before
    // this step even runs. Proofreading is polish, not a gate — if kie.ai
    // is having a rough moment, skip this chapter's proofread rather than
    // failing the whole batch (which would block the audits/PDF/delivery
    // that already happened) over a typo-fixing pass.
    let text, model;
    try {
      ({ text, model } = await chatComplete({
        phase: 'proofread',
        system:
          'Вычитай художественный текст на опечатки, орфографию и пунктуацию. ' +
          'Не меняй сюжет, стиль и объём. В ответе выведи ТОЛЬКО исправленный текст целиком, ' +
          'без комментариев, без списка найденных ошибок, без пояснений — только сам текст главы.',
        prompt: original,
        targetWords: originalWords,
      }));
    } catch (err) {
      jobStore.appendLog(job.id, `Proofread: вычитка главы ${i} не удалась (${err.message}) — оставляю как есть.`);
      continue;
    }

    if (wordCount(text) < originalWords * 0.6) {
      jobStore.appendLog(
        job.id,
        `Proofread: ответ модели (${model}) подозрительно короткий для главы ${i} — похоже на комментарий, а не текст. Оставляю без изменений.`
      );
      continue;
    }

    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.appendLog(job.id, `Proofread: глава ${i} готова (модель ${model})`);
  }

  return {};
}

module.exports = { run };
