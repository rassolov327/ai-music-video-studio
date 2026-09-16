const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readFullManuscript } = require('../manuscript');

// Analysis-only pass: rhythm, dialogue, imagery, transitions. Recorded as a
// report rather than rewriting the whole book again (revision.js already
// handles targeted rewrites) — keeps cost bounded.
async function run(job) {
  jobStore.appendLog(job.id, 'Literary edit: оцениваю ритм, диалоги, образность');
  const manuscript = readFullManuscript(job.id);

  const { text, model } = await chatComplete({
    phase: 'literaryEdit',
    system:
      'Ты — литературный редактор. Оцени ритм предложений/абзацев/сцен, диалоги, ' +
      'плотность метафор, переходы, начало и финал. Дай конкретные рекомендации.',
    prompt: manuscript,
    targetWords: 400,
  });

  jobStore.writeFile(job.id, 'quality/final_editorial_report.md', text);
  jobStore.appendLog(job.id, `Literary edit: отчёт готов (модель ${model})`);
  return {};
}

module.exports = { run };
