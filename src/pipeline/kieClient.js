// Client for kie.ai chat-completions. In DRY_RUN (no KIE_API_KEY set) it never
// makes a network call or spends credits — it fabricates plausible Russian
// filler text so the rest of the pipeline (files, PDF, logs, email) can be
// exercised end-to-end for free.

const KIE_API_BASE = process.env.KIE_API_BASE || 'https://api.kie.ai/v1';
const KIE_API_KEY = process.env.KIE_API_KEY || null;

// Which kie.ai model handles which pipeline phase. Chosen from kie.ai's live
// pricing page (2026-09): strong creative model for prose, a huge-context
// model for whole-manuscript audits, cheap models for mechanical passes.
const MODEL_TABLE = {
  architecture: { model: 'claude-opus-5', provider: 'Anthropic' },
  draft: { model: 'claude-sonnet-5', provider: 'Anthropic' },
  continuityAudit: { model: 'Gemini 3.6 Flash', provider: 'Google' },
  canonAudit: { model: 'Gemini 3.1 Pro', provider: 'Google' },
  redTeam: { model: 'claude-opus-5', provider: 'Anthropic' },
  revision: { model: 'claude-sonnet-5', provider: 'Anthropic' },
  literaryEdit: { model: 'claude-opus-5', provider: 'Anthropic' },
  microAudits: { model: 'Claude-Haiku-4-5', provider: 'Anthropic' },
  proofread: { model: 'gpt-5.6-luna', provider: 'OpenAI' },
};

function isDryRun() {
  return !KIE_API_KEY;
}

const FILLER_WORDS = (
  'дом коридор тишина свет тень окно голос память ' +
  'страх сон стекло дверь письмо доктор палата город улица дождь ' +
  'ребёнок мать отец брат сестра друг враг время место история ' +
  'боль надежда тьма пепел зеркало кровь бумага телефон часы шаги ' +
  'ветер запах вкус холод тепло взгляд рука сердце дыхание крик шёпот'
).split(' ');

function pseudoSentence(rand) {
  const len = 6 + Math.floor(rand() * 10);
  const words = [];
  for (let i = 0; i < len; i++) {
    words.push(FILLER_WORDS[Math.floor(rand() * FILLER_WORDS.length)]);
  }
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h;
}

// Produces ~targetWords words of placeholder Russian prose, deterministic per
// promptKey so re-runs (resumed jobs) don't regenerate different filler.
function dryRunText(promptKey, targetWords) {
  const rand = mulberry32(hashSeed(promptKey));
  const words = Math.max(30, targetWords || 300);
  let count = 0;
  const paragraphs = [];
  while (count < words) {
    const sentences = [];
    const sentCount = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < sentCount; i++) {
      const s = pseudoSentence(rand);
      sentences.push(s);
      count += s.split(' ').length;
    }
    paragraphs.push(sentences.join(' '));
  }
  return paragraphs.join('\n\n');
}

/**
 * @param {object} opts
 * @param {string} opts.phase - key into MODEL_TABLE
 * @param {string} opts.system - system prompt (ignored in dry-run)
 * @param {string} opts.prompt - user prompt (used as seed key in dry-run)
 * @param {number} [opts.targetWords] - approx desired output length in words
 * @returns {Promise<{text: string, model: string, dryRun: boolean}>}
 */
async function chatComplete({ phase, system, prompt, targetWords = 300 }) {
  const route = MODEL_TABLE[phase];
  if (!route) throw new Error(`Unknown pipeline phase for kieClient: ${phase}`);

  if (isDryRun()) {
    // Small artificial delay so live logs feel like real work is happening.
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    return {
      text: dryRunText(phase + '::' + prompt.slice(0, 80), targetWords),
      model: route.model,
      dryRun: true,
    };
  }

  const res = await fetch(`${KIE_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KIE_API_KEY}`,
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        { role: 'system', content: system || '' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`kie.ai request failed (${res.status}) for phase ${phase}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { text, model: route.model, dryRun: false };
}

module.exports = { chatComplete, isDryRun, MODEL_TABLE };
