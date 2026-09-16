// Research is never done by kie.ai models at runtime (they can't browse the
// web). Instead, a human/agent gathers material for a given game ahead of
// time and ships it as static markdown under research-data/<slug>/. This
// phase just copies that pre-baked corpus into the job's research/ and
// canon/ folders. If nobody has researched the requested game yet, the job
// fails with a clear, actionable error instead of guessing.

const fs = require('fs');
const path = require('path');
const jobStore = require('../../jobStore');

const RESEARCH_ROOT = path.join(__dirname, '..', '..', '..', 'research-data');

// Normalize free-text game titles to a research-data folder slug.
const ALIASES = {
  sanitarium: 'sanitarium',
  'sanitarium (1998)': 'sanitarium',
  'шизариум': 'sanitarium',
  shizarium: 'sanitarium',
};

function slugFor(gameTitle) {
  const key = String(gameTitle || '').trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  const normalized = key.replace(/[^a-zа-я0-9]+/gi, '');
  for (const [alias, slug] of Object.entries(ALIASES)) {
    if (normalized.includes(alias.replace(/[^a-zа-я0-9]+/gi, ''))) return slug;
  }
  return null;
}

async function run(job) {
  const slug = slugFor(job.input.game);
  if (!slug) {
    throw new Error(
      `Для игры "${job.input.game}" ещё нет готового research-корпуса. ` +
        `Сейчас поддерживается только: Sanitarium. Нужно сначала вручную собрать материалы ` +
        `в research-data/<slug>/ прежде чем запускать эту игру.`
    );
  }
  const srcDir = path.join(RESEARCH_ROOT, slug);
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Research-корпус для "${slug}" не найден по пути ${srcDir}`);
  }

  jobStore.appendLog(job.id, `Research: использую готовый корпус "${slug}"`);

  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const dest = file.startsWith('story_bible') || file.startsWith('timeline') || file.startsWith('reality_map') ||
      file.startsWith('characters') || file.startsWith('worlds') || file.startsWith('adaptation_rules')
      ? path.join('canon', file)
      : path.join('research', file);
    jobStore.writeFile(job.id, dest, content);
    jobStore.appendLog(job.id, `Research: скопирован ${file}`);
  }

  return { slug, filesCopied: files.length };
}

module.exports = { run, slugFor };
