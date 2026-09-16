const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readFullManuscript } = require('../manuscript');

// Cheap, incremental-style pass: checks names/dates/objects/relationships
// stay consistent across chapters. Uses a lighter model since it runs often.
async function run(job) {
  jobStore.appendLog(job.id, 'Continuity: проверяю имена, даты, предметы, отношения персонажей');
  const manuscript = readFullManuscript(job.id);

  const { text, model } = await chatComplete({
    phase: 'continuityAudit',
    system:
      'Ты — редактор по непрерывности повествования. Найди несоответствия в именах, датах, ' +
      'возрасте, географии, знаниях персонажей. Формат: список находок или "Проблем не найдено".',
    prompt: manuscript,
    targetWords: 300,
  });

  jobStore.writeFile(job.id, 'quality/continuity_database.md', text);
  jobStore.appendLog(job.id, `Continuity: отчёт готов (модель ${model})`);
  return {};
}

module.exports = { run };
