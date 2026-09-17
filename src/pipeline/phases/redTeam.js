const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readBatchManuscript } = require('../manuscript');

async function run(job, { fromChapter, toChapter }) {
  jobStore.appendLog(job.id, `Red team: ищу слабые места в главах ${fromChapter}-${toChapter}`);
  const batchText = readBatchManuscript(job.id, fromChapter, toChapter);

  const { text, model } = await chatComplete({
    phase: 'redTeam',
    system:
      'Ты — придирчивый критик. Найди скучные сцены, фальшивый пафос, экспозицию, ' +
      'слабые диалоги, проблемы темпа, клише, дыры в сюжете, слабые концовки глав.',
    prompt: batchText,
    targetWords: 350,
  });

  const outFile = `quality/batch_${String(job.currentBatch).padStart(2, '0')}_red_team.md`;
  jobStore.writeFile(job.id, outFile, text);
  jobStore.appendLog(job.id, `Red team: отчёт готов (модель ${model})`);
  return { report: text, reportFile: outFile };
}

module.exports = { run };
