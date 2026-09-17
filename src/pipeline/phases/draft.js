const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');
const stateLedger = require('../stateLedger');
const { chapterFileName } = require('../manuscript');

async function checkChapter(job, chapterIndex, chapterText, storyBible, ledger) {
  const { text } = await chatComplete({
    phase: 'chapterCheck',
    system:
      'Сверь главу с дневником состояния и Story Bible. Если есть явные противоречия ' +
      '(имена, факты, хронология, кто что знает) — перечисли их кратко, по одному на строку. ' +
      'Если противоречий нет, ответь ровно одним словом: OK.',
    prompt: `Story Bible:\n${storyBible}\n\nДневник состояния:\n${ledger || '(пусто)'}\n\nГлава ${chapterIndex}:\n${chapterText}`,
    targetWords: 120,
  });
  const trimmed = text.trim();
  if (!/^ok\.?$/i.test(trimmed)) {
    jobStore.writeFile(
      job.id,
      `quality/batch_${String(job.currentBatch).padStart(2, '0')}_flags.md`,
      `${jobStore.exists(job.id, `quality/batch_${String(job.currentBatch).padStart(2, '0')}_flags.md`)
        ? jobStore.readFile(job.id, `quality/batch_${String(job.currentBatch).padStart(2, '0')}_flags.md`) + '\n\n'
        : ''}## Глава ${chapterIndex}\n${trimmed}`
    );
    jobStore.appendLog(job.id, `Draft: проверка главы ${chapterIndex} нашла возможные нестыковки — учтётся при правках блока`);
  }
}

// Writes chapters [fromChapter..toChapter] (one batch). Resumable: chapters
// already present on disk are skipped, so retrying a crashed batch doesn't
// redo (and re-pay for) chapters already written.
async function run(job, { fromChapter, toChapter } = {}) {
  const chapters = JSON.parse(jobStore.readFile(job.id, 'planning/chapters.json'));
  const from = fromChapter ?? chapters[0].index;
  const to = toChapter ?? chapters[chapters.length - 1].index;
  const batchChapters = chapters.filter((c) => c.index >= from && c.index <= to);

  const architecture = jobStore.readFile(job.id, 'planning/novel_architecture.md');
  const storyBible = jobStore.exists(job.id, 'canon/story_bible.md')
    ? jobStore.readFile(job.id, 'canon/story_bible.md')
    : '';

  jobStore.updateJob(job.id, { chaptersTotal: chapters.length });

  for (const ch of batchChapters) {
    const file = chapterFileName(ch.index);
    if (jobStore.exists(job.id, `manuscript/${file}`)) {
      jobStore.updateJob(job.id, { chaptersWritten: ch.index });
      continue; // already written in a previous attempt at this batch
    }

    jobStore.appendLog(job.id, `Draft: пишу главу ${ch.index}/${chapters.length}`);
    const ledger = stateLedger.readLedger(job.id);

    const { text, model } = await chatComplete({
      phase: 'draft',
      system:
        `Ты пишешь роман: ${job.input.style}-подобные литературные качества (без копирования ` +
        `фирменных фраз), психологический хоррор, язык — ${job.input.language}.`,
      prompt:
        `Story Bible:\n${storyBible}\n\nПлан романа:\n${architecture}\n\n` +
        `Дневник состояния (что уже произошло к этому моменту):\n${ledger || '(это первая глава романа)'}\n\n` +
        `Глава ${ch.index} из ${chapters.length}. О чём эта глава: ${ch.brief}\n\n` +
        `Напиши главу ${ch.index} целиком, ~${ch.targetWords} слов.`,
      targetWords: ch.targetWords,
    });

    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    jobStore.updateJob(job.id, { chaptersWritten: ch.index });
    jobStore.appendLog(job.id, `Draft: глава ${ch.index} готова (модель ${model}, ${text.split(/\s+/).length} слов)`);

    if (chapters.length > 1) {
      // Best-effort: the chapter itself is already written and saved above.
      // The ledger/consistency-check are memory aids for later chapters and
      // the batch-level audits, not a reason to lose an already-paid-for
      // chapter to a transient kie.ai error.
      try {
        await stateLedger.updateLedger(job.id, ch.index, text);
      } catch (err) {
        jobStore.appendLog(job.id, `Draft: не удалось обновить дневник состояния после главы ${ch.index} (${err.message}) — продолжаю без обновления.`);
      }
      try {
        await checkChapter(job, ch.index, text, storyBible, stateLedger.readLedger(job.id));
      } catch (err) {
        jobStore.appendLog(job.id, `Draft: проверка главы ${ch.index} не удалась (${err.message}) — пропускаю.`);
      }
    }
  }

  return { chapters: batchChapters.length };
}

module.exports = { run };
