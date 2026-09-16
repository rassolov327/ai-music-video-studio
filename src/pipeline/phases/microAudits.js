const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readFullManuscript, chapterFiles } = require('../manuscript');

// Cheap, targeted checks: repetition, dialogue voice, opening, ending.
// Bundled into one phase since each is a small, focused prompt on a cheap
// model (see kieClient.MODEL_TABLE: microAudits -> Haiku).
async function run(job) {
  const manuscript = readFullManuscript(job.id);
  const files = chapterFiles(job.id);
  const opening = files.length ? jobStore.readFile(job.id, `manuscript/${files[0]}`) : '';
  const ending = files.length ? jobStore.readFile(job.id, `manuscript/${files[files.length - 1]}`) : '';

  jobStore.appendLog(job.id, 'Micro-audits: повторы, диалоги, открытие, финал');

  const checks = [
    { key: 'repetition', prompt: manuscript, note: 'Найди навязчивые повторы слов/образов/конструкций.' },
    { key: 'dialogue', prompt: manuscript, note: 'Оцени, различимы ли голоса персонажей в диалогах.' },
    { key: 'opening', prompt: opening, note: 'Первые страницы: цепляют ли, нет ли лишней экспозиции?' },
    { key: 'ending', prompt: ending, note: 'Финал: есть ли эмоциональная/тематическая развязка, нет ли дешёвых объяснений?' },
  ];

  const results = {};
  for (const c of checks) {
    const { text, model } = await chatComplete({
      phase: 'microAudits',
      system: c.note,
      prompt: c.prompt,
      targetWords: 150,
    });
    results[c.key] = text;
    jobStore.appendLog(job.id, `Micro-audits: ${c.key} готов (модель ${model})`);
  }

  const report = Object.entries(results)
    .map(([k, v]) => `## ${k}\n\n${v}`)
    .join('\n\n');
  jobStore.writeFile(job.id, 'quality/micro_audits.md', report);

  return {};
}

module.exports = { run };
