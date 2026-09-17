const jobStore = require('../jobStore');

function chapterFileName(index) {
  return `chapter_${String(index).padStart(3, '0')}.md`;
}

// Concatenates all chapter files into one string, in order.
function readFullManuscript(jobId) {
  const files = chapterFiles(jobId);
  return files.map((f) => jobStore.readFile(jobId, `manuscript/${f}`)).join('\n\n---\n\n');
}

// Only the chapters belonging to one batch — audits/revision operate on
// just this range so a growing book doesn't mean a growing audit context
// (and so a batch's checks can't be thrown off by earlier batches that
// already passed their own checks).
function readBatchManuscript(jobId, fromChapter, toChapter) {
  const parts = [];
  for (let i = fromChapter; i <= toChapter; i++) {
    const file = chapterFileName(i);
    if (jobStore.exists(jobId, `manuscript/${file}`)) {
      parts.push(jobStore.readFile(jobId, `manuscript/${file}`));
    }
  }
  return parts.join('\n\n---\n\n');
}

function batchChapterFiles(jobId, fromChapter, toChapter) {
  const files = [];
  for (let i = fromChapter; i <= toChapter; i++) {
    const file = chapterFileName(i);
    if (jobStore.exists(jobId, `manuscript/${file}`)) files.push(file);
  }
  return files;
}

function chapterFiles(jobId) {
  return jobStore.listFiles(jobId, 'manuscript').filter((f) => f.endsWith('.md'));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

module.exports = {
  chapterFileName,
  readFullManuscript,
  readBatchManuscript,
  batchChapterFiles,
  chapterFiles,
  wordCount,
};
