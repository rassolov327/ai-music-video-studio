const jobStore = require('../jobStore');
const { chatComplete } = require('./kieClient');

const LEDGER_PATH = 'planning/state_ledger.md';

// The "session document" / recursive-summarization pattern used by working
// long-form AI writing tools: instead of feeding a growing pile of raw
// previous chapters into each new prompt (expensive, and dilutes what
// actually matters), keep one compact, continuously REWRITTEN document of
// where things stand — character states, open plot threads, established
// facts, chronology. Bounded size regardless of how long the book gets.
function readLedger(jobId) {
  return jobStore.exists(jobId, LEDGER_PATH) ? jobStore.readFile(jobId, LEDGER_PATH) : '';
}

async function updateLedger(jobId, chapterIndex, chapterText) {
  const previous = readLedger(jobId);
  const { text } = await chatComplete({
    phase: 'stateLedger',
    system:
      'Ты ведёшь компактный "дневник состояния" романа для следующего автора главы. ' +
      'На основе предыдущей версии дневника и новой главы перепиши дневник целиком — ' +
      'актуальные факты, а не историю изменений. Разделы: ПЕРСОНАЖИ (где каждый, что знает, ' +
      'физическое/эмоциональное состояние), НЕЗАКРЫТЫЕ СЮЖЕТНЫЕ НИТИ, ХРОНОЛОГИЯ, ' +
      'ВАЖНЫЕ УСТАНОВЛЕННЫЕ ФАКТЫ (имена, предметы, места). Кратко, только суть, ' +
      'без пересказа сюжета главы целиком.',
    prompt: `Предыдущий дневник состояния:\n${previous || '(пусто — это первая глава)'}\n\n` +
      `Глава ${chapterIndex}, только что написанная:\n${chapterText}`,
    targetWords: 350,
  });
  jobStore.writeFile(jobId, LEDGER_PATH, text);
  return text;
}

module.exports = { readLedger, updateLedger, LEDGER_PATH };
