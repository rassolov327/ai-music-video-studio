const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readBatchManuscript } = require('../manuscript');

// Scoped to just this batch's chapters — cheap, and errors cluster locally
// (see project notes on long-form LLM consistency research), so catching
// them per-batch beats one pass over the whole growing manuscript.
async function run(job, { fromChapter, toChapter }) {
  jobStore.appendLog(job.id, `Continuity: проверяю главы ${fromChapter}-${toChapter}`);
  const batchText = readBatchManuscript(job.id, fromChapter, toChapter);

  const { text, model } = await chatComplete({
    phase: 'continuityAudit',
    system:
      'Ты — редактор по непрерывности повествования. Найди несоответствия в именах, датах, ' +
      'возрасте, географии, знаниях персонажей в пределах этих глав. Формат: список находок или "Проблем не найдено".',
    prompt: batchText,
    targetWords: 250,
  });

  jobStore.writeFile(job.id, `quality/batch_${String(job.currentBatch).padStart(2, '0')}_continuity.md`, text);
  jobStore.appendLog(job.id, `Continuity: отчёт готов (модель ${model})`);
  return {};
}

module.exports = { run };
