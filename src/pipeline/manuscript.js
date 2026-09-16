const jobStore = require('../jobStore');

// Concatenates all chapter files into one string, in order.
function readFullManuscript(jobId) {
  const files = jobStore.listFiles(jobId, 'manuscript').filter((f) => f.endsWith('.md'));
  return files.map((f) => jobStore.readFile(jobId, `manuscript/${f}`)).join('\n\n---\n\n');
}

function chapterFiles(jobId) {
  return jobStore.listFiles(jobId, 'manuscript').filter((f) => f.endsWith('.md'));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

module.exports = { readFullManuscript, chapterFiles, wordCount };
