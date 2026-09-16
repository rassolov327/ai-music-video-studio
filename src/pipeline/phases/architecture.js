const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');

// Turns the Story Bible into a chapter-by-chapter plan sized to the
// requested word count (~2500 words/chapter is a natural pacing unit).
async function run(job) {
  const { game, style, targetWords, language } = job.input;
  const chapterLen = 2500;
  const chapterCount = Math.max(8, Math.round(targetWords / chapterLen));

  jobStore.appendLog(job.id, `Architecture: планирую ${chapterCount} глав (~${chapterLen} слов каждая)`);

  const storyBible = jobStore.exists(job.id, 'canon/story_bible.md')
    ? jobStore.readFile(job.id, 'canon/story_bible.md')
    : '';

  const { text: architecture, model } = await chatComplete({
    phase: 'architecture',
    system:
      'Ты — литературный архитектор. На основе Story Bible построй план романа: тема, ' +
      'арки персонажей, структура по главам, ключевые повороты, кульминация, финал.',
    prompt:
      `Игра: ${game}\nСтиль: ${style}\nЯзык: ${language}\nЦелевой объём: ${targetWords} слов, ${chapterCount} глав.\n\n` +
      `Story Bible:\n${storyBible}`,
    targetWords: 1200,
  });
  jobStore.writeFile(job.id, 'planning/novel_architecture.md', architecture);
  jobStore.appendLog(job.id, `Architecture: novel_architecture.md готов (модель ${model})`);

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

  // Build a simple per-chapter brief list for the draft phase to consume.
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    index: i + 1,
    targetWords: chapterLen,
  }));
  jobStore.writeFile(job.id, 'planning/chapters.json', JSON.stringify(chapters, null, 2));

  return { chapterCount };
}

module.exports = { run };
