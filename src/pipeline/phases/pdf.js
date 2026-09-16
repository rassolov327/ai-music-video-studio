const jobStore = require('../../jobStore');
const { renderNovelPdf } = require('../../pdf/render');
const { chapterFiles } = require('../manuscript');

function chapterHeading(index, total) {
  return `Глава ${index}`;
}

async function run(job) {
  jobStore.appendLog(job.id, 'PDF: собираю финальный документ');
  const files = chapterFiles(job.id);
  const chapters = files.map((f, i) => ({
    heading: chapterHeading(i + 1, files.length),
    body: jobStore.readFile(job.id, `manuscript/${f}`),
  }));

  const title = `Роман по мотивам «${job.input.game}»`;
  const author = `Литературные качества в духе: ${job.input.style}`;

  const pdfPath = jobStore.jobDir(job.id, 'final', 'FINAL_NOVEL.pdf');
  await renderNovelPdf({ title, author, chapters, outPath: pdfPath });

  const txtPath = jobStore.jobDir(job.id, 'final', 'FINAL_NOVEL.txt');
  const txt = `${title}\n${author}\n\n` + chapters.map((c) => `${c.heading}\n\n${c.body}`).join('\n\n\n');
  jobStore.writeFile(job.id, 'final/FINAL_NOVEL.txt', txt);

  jobStore.appendLog(job.id, 'PDF: FINAL_NOVEL.pdf и FINAL_NOVEL.txt готовы');
  jobStore.updateJob(job.id, { finalPdfPath: pdfPath, finalTxtPath: txtPath });

  return { pdfPath, txtPath };
}

module.exports = { run };
