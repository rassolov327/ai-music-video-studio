const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readBatchManuscript, chapterFileName } = require('../manuscript');

// Cheap, targeted checks scoped to this batch: repetition, dialogue voice,
// plus opening (only if this batch contains chapter 1) and ending (only if
// this batch contains the book's last chapter).
async function run(job, { fromChapter, toChapter }) {
  const batchText = readBatchManuscript(job.id, fromChapter, toChapter);
  jobStore.appendLog(job.id, `Micro-audits: повторы, диалоги (главы ${fromChapter}-${toChapter})`);

  const checks = [
    { key: 'repetition', prompt: batchText, note: 'Найди навязчивые повторы слов/образов/конструкций в этих главах.' },
    { key: 'dialogue', prompt: batchText, note: 'Оцени, различимы ли голоса персонажей в диалогах этих глав.' },
  ];

  if (fromChapter === 1) {
    const opening = jobStore.exists(job.id, `manuscript/${chapterFileName(1)}`)
      ? jobStore.readFile(job.id, `manuscript/${chapterFileName(1)}`)
      : '';
    checks.push({ key: 'opening', prompt: opening, note: 'Первые страницы: цепляют ли, нет ли лишней экспозиции?' });
  }
  if (job.totalChapters && toChapter === job.totalChapters) {
    const ending = jobStore.exists(job.id, `manuscript/${chapterFileName(toChapter)}`)
      ? jobStore.readFile(job.id, `manuscript/${chapterFileName(toChapter)}`)
      : '';
    checks.push({ key: 'ending', prompt: ending, note: 'Финал: есть ли развязка, нет ли дешёвых объяснений?' });
  }

  const results = {};
  for (const c of checks) {
    if (!c.prompt.trim()) continue;
    const { text, model } = await chatComplete({ phase: 'microAudits', system: c.note, prompt: c.prompt, targetWords: 120 });
    results[c.key] = text;
    jobStore.appendLog(job.id, `Micro-audits: ${c.key} готов (модель ${model})`);
  }

  const report = Object.entries(results).map(([k, v]) => `## ${k}\n\n${v}`).join('\n\n');
  jobStore.writeFile(job.id, `quality/batch_${String(job.currentBatch).padStart(2, '0')}_micro.md`, report);
  return {};
}

module.exports = { run };
