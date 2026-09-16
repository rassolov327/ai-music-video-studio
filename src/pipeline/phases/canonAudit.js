const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readFullManuscript } = require('../manuscript');

// Full-manuscript vs. Story Bible comparison. Deliberately routed to a
// huge-context model (see kieClient.MODEL_TABLE) since this needs the whole
// book plus the whole canon in view at once.
async function run(job) {
  jobStore.appendLog(job.id, 'Canon audit: сверяю весь текст с каноном игры');
  const manuscript = readFullManuscript(job.id);
  const storyBible = jobStore.exists(job.id, 'canon/story_bible.md')
    ? jobStore.readFile(job.id, 'canon/story_bible.md')
    : '';

  const { text, model } = await chatComplete({
    phase: 'canonAudit',
    system:
      'Сверь роман с каноном игры (Story Bible). Классифицируй каждое расхождение: ' +
      'CANON ERROR / POSSIBLE CANON ERROR / VALID EXPANSION / INTENTIONAL INTERPRETATION.',
    prompt: `Story Bible:\n${storyBible}\n\nРоман:\n${manuscript}`,
    targetWords: 400,
  });

  jobStore.writeFile(job.id, 'quality/canon_audit.md', text);
  jobStore.appendLog(job.id, `Canon audit: отчёт готов (модель ${model})`);
  return {};
}

module.exports = { run };
