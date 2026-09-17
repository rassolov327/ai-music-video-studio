const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');

const CHAPTER_WORDS = 2500;
const BATCH_CHAPTERS = 4; // ~10,000 words / ~55 pages per batch, per user request

// Parses lines like "12: Макс находит дневник Сары в морге." into
// {index, brief}. Lenient on formatting (models don't always follow a
// strict template) — skips anything that doesn't start with a number.
function parseChapterBriefs(text, expectedCount) {
  const briefs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)[.:)]\s*(.+)$/);
    if (m) briefs.push({ index: Number(m[1]), brief: m[2].trim() });
  }
  // Fall back to generic briefs for any chapter the model skipped, rather
  // than failing the whole book over a formatting slip.
  const byIndex = new Map(briefs.map((b) => [b.index, b.brief]));
  return Array.from({ length: expectedCount }, (_, i) => ({
    index: i + 1,
    brief: byIndex.get(i + 1) || '(план главы не уточнён — писать по общей архитектуре романа)',
    targetWords: CHAPTER_WORDS,
  }));
}

// Plans the WHOLE book once, up front — a fixed master outline that later
// batches draft against, so the story doesn't lose its overall shape even
// though it's written a few chapters at a time. Only sample mode (a single
// throwaway preview chapter) skips this.
async function run(job) {
  const { game, style, targetWords, language, mode } = job.input;
  const isSample = mode === 'sample';
  const chapterLen = isSample ? targetWords : CHAPTER_WORDS;
  const chapterCount = isSample ? 1 : Math.max(8, Math.round(targetWords / chapterLen));

  jobStore.appendLog(job.id, `Architecture: планирую ${chapterCount} глав (~${chapterLen} слов каждая)`);

  const storyBible = jobStore.exists(job.id, 'canon/story_bible.md')
    ? jobStore.readFile(job.id, 'canon/story_bible.md')
    : '';

  const { text: architecture, model } = await chatComplete({
    phase: 'architecture',
    system:
      'Ты — литературный архитектор. На основе Story Bible построй план романа: тема, ' +
      'арки персонажей, структура по главам, ключевые повороты, кульминация, финал.' +
      (isSample ? ' Это ознакомительный фрагмент — распланируй подробно только первую главу.' : ''),
    prompt:
      `Игра: ${game}\nСтиль: ${style}\nЯзык: ${language}\nЦелевой объём: ${targetWords} слов, ${chapterCount} глав.\n\n` +
      `Story Bible:\n${storyBible}`,
    targetWords: isSample ? 400 : 1200,
  });
  jobStore.writeFile(job.id, 'planning/novel_architecture.md', architecture);
  jobStore.appendLog(job.id, `Architecture: novel_architecture.md готов (модель ${model})`);

  let chapters;
  if (isSample) {
    chapters = [{ index: 1, brief: 'Вся глава — по плану выше.', targetWords: chapterLen }];
  } else {
    const { text: foreshadowing } = await chatComplete({
      phase: 'architecture',
      system: 'Составь базу форшедоуинга: ключевые разгадки и где их подготовить заранее.',
      prompt: architecture,
      targetWords: 400,
    });
    jobStore.writeFile(job.id, 'planning/foreshadowing.md', foreshadowing);

    const { text: motifs } = await chatComplete({
      phase: 'architecture',
      system: 'Составь базу повторяющихся мотивов (образы, предметы, фразы).',
      prompt: architecture,
      targetWords: 300,
    });
    jobStore.writeFile(job.id, 'planning/motifs.md', motifs);
    jobStore.appendLog(job.id, 'Architecture: foreshadowing.md и motifs.md готовы');

    const { text: outlineText } = await chatComplete({
      phase: 'architecture',
      system:
        `Распиши краткий план всех ${chapterCount} глав романа по плану выше. ` +
        'Формат СТРОГО построчно: "<номер главы>: <одно предложение — что происходит>". ' +
        'Без заголовков, без markdown-разметки, без пояснений — только пронумерованные строки.',
      prompt: architecture,
      targetWords: Math.min(chapterCount * 20, 2000),
    });
    jobStore.writeFile(job.id, 'planning/full_outline_raw.md', outlineText);
    chapters = parseChapterBriefs(outlineText, chapterCount);
    jobStore.appendLog(job.id, `Architecture: план по главам готов (${chapters.length} шт.)`);
  }

  jobStore.writeFile(job.id, 'planning/chapters.json', JSON.stringify(chapters, null, 2));

  const totalBatches = isSample ? 1 : Math.ceil(chapterCount / BATCH_CHAPTERS);
  jobStore.updateJob(job.id, {
    totalChapters: chapterCount,
    totalBatches,
    currentBatch: 0,
  });

  return { chapterCount, totalBatches };
}

module.exports = { run, BATCH_CHAPTERS, CHAPTER_WORDS };
