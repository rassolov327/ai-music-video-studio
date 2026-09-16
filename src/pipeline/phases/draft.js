const jobStore = require('../../jobStore');
const { chatComplete } = require('../kieClient');

function chapterFileName(index) {
  return `chapter_${String(index).padStart(3, '0')}.md`;
}

// Writes the manuscript chapter by chapter. Resumable: chapters already
// present on disk (from a previous run that crashed/restarted) are skipped.
async function run(job) {
  const chapters = JSON.parse(jobStore.readFile(job.id, 'planning/chapters.json'));
  const architecture = jobStore.readFile(job.id, 'planning/novel_architecture.md');
  const storyBible = jobStore.exists(job.id, 'canon/story_bible.md')
    ? jobStore.readFile(job.id, 'canon/story_bible.md')
    : '';

  jobStore.updateJob(job.id, { chaptersTotal: chapters.length });

  let recap = '';
  for (const ch of chapters) {
    const file = chapterFileName(ch.index);
    if (jobStore.exists(job.id, `manuscript/${file}`)) {
      recap = jobStore.readFile(job.id, `manuscript/${file}`).slice(-1500);
      jobStore.updateJob(job.id, { chaptersWritten: ch.index });
      continue; // already written in a previous attempt
    }

    jobStore.appendLog(job.id, `Draft: пишу главу ${ch.index}/${chapters.length}`);

    const { text, model } = await chatComplete({
      phase: 'draft',
      system:
        `Ты пишешь роман: ${job.input.style}-подобные литературные качества (без копирования ` +
        `фирменных фраз), психологический хоррор, язык — ${job.input.language}.`,
      prompt:
        `Story Bible:\n${storyBible}\n\nПлан романа:\n${architecture}\n\n` +
        `Глава ${ch.index} из ${chapters.length}. Конец предыдущей главы:\n${recap}\n\n` +
        `Напиши главу ${ch.index} целиком, ~${ch.targetWords} слов.`,
      targetWords: ch.targetWords,
    });

    jobStore.writeFile(job.id, `manuscript/${file}`, text);
    recap = text.slice(-1500);
    jobStore.updateJob(job.id, { chaptersWritten: ch.index });
    jobStore.appendLog(job.id, `Draft: глава ${ch.index} готова (модель ${model}, ${text.split(/\s+/).length} слов)`);
  }

  return { chapters: chapters.length };
}

module.exports = { run, chapterFileName };
