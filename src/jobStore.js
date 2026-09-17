const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');

const bus = new EventEmitter();
bus.setMaxListeners(50);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function jobRoot(id) {
  return path.join(JOBS_DIR, id);
}

function jobDir(id, ...parts) {
  return path.join(jobRoot(id), ...parts);
}

function statePath(id) {
  return jobDir(id, 'state.json');
}

const SUBDIRS = ['research', 'canon', 'planning', 'manuscript', 'quality', 'final', 'logs'];

function createJob(input) {
  ensureDir(JOBS_DIR);
  const id = require('crypto').randomUUID();
  const root = jobRoot(id);
  ensureDir(root);
  for (const d of SUBDIRS) ensureDir(path.join(root, d));

  const state = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input,
    status: 'pending', // awaiting_confirmation | pending | running | done | error | cancelled
    confirmed: false,
    costEstimate: null,
    phaseIndex: 0,
    phaseKey: null,
    phaseLabel: null,
    progressPercent: 0,
    chaptersWritten: 0,
    chaptersTotal: null,
    error: null,
    finalPdfPath: null,
    finalTxtPath: null,
    emailSent: false,
    // Batched (full-mode) generation: the book is planned once, then written
    // a few chapters at a time, each batch re-confirmed for spend before it
    // starts. Unused/null for 'sample' mode (single chapter, no batching).
    totalChapters: null,
    totalBatches: null,
    currentBatch: 0,
    batches: [], // [{ index, fromChapter, toChapter, pdfPath, txtPath, emailSent }]
  };
  fs.writeFileSync(statePath(id), JSON.stringify(state, null, 2), 'utf8');
  fs.writeFileSync(jobDir(id, 'logs', 'progress.log'), '', 'utf8');
  return state;
}

function getJob(id) {
  try {
    return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));
  } catch {
    return null;
  }
}

function listJobs() {
  ensureDir(JOBS_DIR);
  return fs
    .readdirSync(JOBS_DIR)
    .map((id) => getJob(id))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateJob(id, patch) {
  const state = getJob(id);
  if (!state) throw new Error(`Job ${id} not found`);
  const next = { ...state, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(statePath(id), JSON.stringify(next, null, 2), 'utf8');
  bus.emit(`state:${id}`, next);
  return next;
}

function appendLog(id, line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  fs.appendFileSync(jobDir(id, 'logs', 'progress.log'), stamped + '\n', 'utf8');
  bus.emit(`log:${id}`, stamped);
  return stamped;
}

function readLog(id) {
  try {
    return fs.readFileSync(jobDir(id, 'logs', 'progress.log'), 'utf8');
  } catch {
    return '';
  }
}

function writeFile(id, relPath, content) {
  const full = jobDir(id, relPath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

function readFile(id, relPath) {
  return fs.readFileSync(jobDir(id, relPath), 'utf8');
}

function listFiles(id, relDir) {
  const full = jobDir(id, relDir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).sort();
}

function exists(id, relPath) {
  return fs.existsSync(jobDir(id, relPath));
}

module.exports = {
  DATA_DIR,
  JOBS_DIR,
  bus,
  ensureDir,
  jobRoot,
  jobDir,
  createJob,
  getJob,
  listJobs,
  updateJob,
  appendLog,
  readLog,
  writeFile,
  readFile,
  listFiles,
  exists,
};
