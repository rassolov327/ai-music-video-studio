const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const { readFullManuscript } = require('../manuscript');

async function run(job, { pass = 1 } = {}) {
  jobStore.appendLog(job.id, `Red team (проход ${pass}): ищу слабые места придирчиво`);
  const manuscript = readFullManuscript(job.id);

  const { text, model } = await chatComplete({
    phase: 'redTeam',
    system:
      'Ты — придирчивый критик. Найди скучные сцены, фальшивый пафос, экспозицию, ' +
      'слабые диалоги, проблемы темпа, клише, дыры в сюжете, слабые концовки глав.',
    prompt: manuscript,
    targetWords: 500,
  });

  const outFile = pass === 1 ? 'quality/red_team_report.md' : 'quality/red_team_report_2.md';
  jobStore.writeFile(job.id, outFile, text);
  jobStore.appendLog(job.id, `Red team (проход ${pass}): отчёт готов (модель ${model})`);
  return { report: text };
}

module.exports = { run };
