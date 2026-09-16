// Client for kie.ai chat-completions. In DRY_RUN (no KIE_API_KEY set) it never
// makes a network call or spends credits — it fabricates plausible Russian
// filler text so the rest of the pipeline (files, PDF, logs, email) can be
// exercised end-to-end for free.

const KIE_API_BASE = process.env.KIE_API_BASE || 'https://api.kie.ai';
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

  const { url, body, extractText } = buildRequest(route, system, prompt);

  // Upstream providers occasionally return a transient 5xx ("internal
  // error, try again later") — retry a few times with backoff before
  // giving up, rather than failing the whole job over a blip.
  const MAX_ATTEMPTS = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KIE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      lastErr = new Error(`kie.ai request failed (${res.status}) for phase ${phase}: ${errBody.slice(0, 500)}`);
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw lastErr;
    }

    const data = await res.json();
    // kie.ai's gateway returns HTTP 200 even on its own errors (bad key,
    // rate limit, transient upstream failure) — the real outcome is in a
    // numeric top-level `code` field (200 = ok). Native provider success
    // responses never have this field, so its presence+non-200 value
    // unambiguously means a gateway error, not a real model response.
    if (typeof data.code === 'number' && data.code !== 200) {
      lastErr = new Error(`kie.ai error (code ${data.code}) for phase ${phase}: ${data.msg || 'unknown error'}`);
      if (data.code >= 500 && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw lastErr;
    }

    const text = extractText(data);
    if (!text) {
      lastErr = new Error(`kie.ai returned an empty response for phase ${phase} (model ${route.model}) — check response shape: ${JSON.stringify(data).slice(0, 300)}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw lastErr;
    }
    return { text, model: route.model, dryRun: false };
  }
  throw lastErr;
}

// kie.ai doesn't expose one uniform chat-completions endpoint — each
// provider family uses its own path and native request/response shape.
// Confirmed against docs.kie.ai (2026-09): Claude -> Anthropic Messages API,
// GPT -> OpenAI Responses API, Gemini -> OpenAI Chat Completions API.
// Re-verify against the live docs before the first real paid run — these
// shift as kie.ai adds model versions.
function buildRequest(route, system, prompt) {
  const slug = route.model.toLowerCase().replace(/\s+/g, '-');

  if (route.provider === 'Anthropic') {
    return {
      url: `${KIE_API_BASE}/claude/v1/messages`,
      body: {
        model: route.model,
        max_tokens: 8192,
        system: system || '',
        messages: [{ role: 'user', content: prompt }],
      },
      extractText: (data) => (data.content || []).map((b) => b.text || '').join(''),
    };
  }

  if (route.provider === 'OpenAI') {
    return {
      url: `${KIE_API_BASE}/codex/v1/responses`,
      body: {
        model: slug,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system || '' }] },
          { role: 'user', content: [{ type: 'input_text', text: prompt }] },
        ],
      },
      extractText: (data) => {
        const msg = (data.output || []).find((o) => o.type === 'message');
        return (msg?.content || []).map((c) => c.text || '').join('');
      },
    };
  }

  // Google / Gemini
  return {
    url: `${KIE_API_BASE}/${slug}/v1/chat/completions`,
    body: {
      model: slug,
      messages: [
        { role: 'system', content: system || '' },
        { role: 'user', content: prompt },
      ],
    },
    extractText: (data) => data.choices?.[0]?.message?.content || '',
  };
}

async function getCreditBalance() {
  if (!KIE_API_KEY) return { available: false };
  const res = await fetch(`${KIE_API_BASE}/api/v1/chat/credit`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
  });
  // kie.ai returns HTTP 200 even on auth failure — the real result is in
  // the JSON body's own `code` field, not the HTTP status.
  if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
  const data = await res.json();
  if (data.code !== 200) return { available: false, error: data.msg || `code ${data.code}` };
  return { available: true, credits: data.data };
}

module.exports = { chatComplete, isDryRun, MODEL_TABLE, getCreditBalance };
