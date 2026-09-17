const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readBatchManuscript } = require('../manuscript');

async function run(job, { fromChapter, toChapter }) {
  jobStore.appendLog(job.id, `Canon audit: сверяю главы ${fromChapter}-${toChapter} с каноном игры`);
  const batchText = readBatchManuscript(job.id, fromChapter, toChapter);
  const storyBible = jobStore.exists(job.id, 'canon/story_bible.md')
    ? jobStore.readFile(job.id, 'canon/story_bible.md')
    : '';

  const { text, model } = await chatComplete({
    phase: 'canonAudit',
    system:
      'Сверь эти главы романа с каноном игры (Story Bible). Классифицируй каждое расхождение: ' +
      'CANON ERROR / POSSIBLE CANON ERROR / VALID EXPANSION / INTENTIONAL INTERPRETATION.',
    prompt: `Story Bible:\n${storyBible}\n\nГлавы:\n${batchText}`,
    targetWords: 300,
  });

  jobStore.writeFile(job.id, `quality/batch_${String(job.currentBatch).padStart(2, '0')}_canon.md`, text);
  jobStore.appendLog(job.id, `Canon audit: отчёт готов (модель ${model})`);
  return {};
}

module.exports = { run };
