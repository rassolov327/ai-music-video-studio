const jobStore = require('../../jobStore');
const { renderNovelPdf } = require('../../pdf/render');
const { chapterFileName } = require('../manuscript');

function chapterHeading(index) {
  return `Глава ${index}`;
}

// Renders just this batch's chapters into their own PDF/txt — the user
// reads a growing set of separate files, not one that's rebuilt from
// scratch (and re-downloaded in full) after every batch.
async function run(job, { fromChapter, toChapter, isSample = false } = {}) {
  jobStore.appendLog(job.id, `PDF: собираю документ для глав ${fromChapter}-${toChapter}`);

  const chapters = [];
  for (let i = fromChapter; i <= toChapter; i++) {
    const file = chapterFileName(i);
    if (jobStore.exists(job.id, `manuscript/${file}`)) {
      chapters.push({ heading: chapterHeading(i), body: jobStore.readFile(job.id, `manuscript/${file}`) });
    }
  }

  const title = isSample
    ? `«${job.input.game}» — ознакомительный фрагмент`
    : `«${job.input.game}»: главы ${fromChapter}–${toChapter}`;
  const author = `Литературные качества в духе: ${job.input.style}`;

  const baseName = isSample ? 'FINAL_NOVEL' : `batch_${String(job.currentBatch).padStart(2, '0')}_ch${fromChapter}-${toChapter}`;
  const pdfPath = jobStore.jobDir(job.id, 'final', `${baseName}.pdf`);
  await renderNovelPdf({ title, author, chapters, outPath: pdfPath });

  const txtPath = jobStore.jobDir(job.id, 'final', `${baseName}.txt`);
  const txt = `${title}\n${author}\n\n` + chapters.map((c) => `${c.heading}\n\n${c.body}`).join('\n\n\n');
  jobStore.writeFile(job.id, `final/${baseName}.txt`, txt);

  jobStore.appendLog(job.id, `PDF: ${baseName}.pdf готов`);

  if (isSample) {
    jobStore.updateJob(job.id, { finalPdfPath: pdfPath, finalTxtPath: txtPath });
  } else {
    const batches = [...(job.batches || [])];
    batches.push({
      index: job.currentBatch,
      fromChapter,
      toChapter,
      pdfPath,
      txtPath,
      emailSent: false,
    });
    jobStore.updateJob(job.id, { batches, finalPdfPath: pdfPath, finalTxtPath: txtPath });
  }

  return { pdfPath, txtPath };
}

module.exports = { run };
