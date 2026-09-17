// Rough cost estimator shown to the user before any real kie.ai spend is
// authorized. Mirrors the token usage shape of the actual phases (see
// phases/*.js) closely enough to be directionally correct, not exact —
// presented as a low/high range for that reason.

const PRICING_USD_PER_M_TOKENS = {
  'claude-opus-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 0.85, out: 4.275 },
  'Gemini 3.6 Flash': { in: 0.225, out: 1.125 },
  'Gemini 3.1 Pro': { in: 0.5, out: 3.5 },
  'Claude-Haiku-4-5': { in: 0.275, out: 1.425 },
  'gpt-5.6-luna': { in: 0.056, out: 0.336 },
  // Actual slugs kieClient.js currently routes through (Claude's kie.ai
  // proxy was unstable 2026-09-16/17 — see kieClient.js comments). Same
  // price tier as their display-name siblings above; gemini-3-pro's exact
  // rate wasn't scraped, approximated from Gemini 3.1 Pro.
  'gemini-3-8-flash-openai': { in: 0.225, out: 1.125 },
  'gemini-3-pro': { in: 0.5, out: 3.5 },
  'gpt-5-6-luna': { in: 0.056, out: 0.336 },
};

// Cyrillic prose tokenizes at roughly 2 tokens/word — a working estimate,
// the single biggest source of uncertainty here.
const TOKENS_PER_WORD = 2;

// kie.ai's own "Credits / Gen" column is ~200 credits per $1 across the
// models above (e.g. claude-sonnet-5 output: 855 credits = $4.275).
const CREDITS_PER_USD = 200;

function lineCost(model, inWords, outWords) {
  const p = PRICING_USD_PER_M_TOKENS[model];
  const inTok = inWords * TOKENS_PER_WORD;
  const outTok = outWords * TOKENS_PER_WORD;
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

function estimateCost({ targetWords, mode = 'full' }) {
  if (mode === 'sample') {
    // One chapter, no audits/revision passes — just draft + a light proofread.
    const items = [
      { label: 'Архитектура (только глава 1)', model: 'gemini-3-8-flash-openai', cost: lineCost('gemini-3-8-flash-openai', 1000, 400) },
      { label: 'Черновик главы 1', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', 3000, targetWords) },
      { label: 'Финальная вычитка', model: 'gpt-5-6-luna', cost: lineCost('gpt-5-6-luna', targetWords, targetWords) },
    ];
    const subtotalUsd = items.reduce((s, i) => s + i.cost, 0);
    return {
      chapterCount: 1,
      manuscriptWords: targetWords,
      items: items.map((i) => ({ ...i, cost: Math.round(i.cost * 100) / 100 })),
      lowUsd: Math.round(subtotalUsd * 100) / 100,
      highUsd: Math.round(subtotalUsd * 2 * 100) / 100,
      lowCredits: Math.round(subtotalUsd * CREDITS_PER_USD),
      highCredits: Math.round(subtotalUsd * 2 * CREDITS_PER_USD),
    };
  }

  const chapterWords = 2500;
  const chapterCount = Math.max(8, Math.round(targetWords / chapterWords));
  const manuscriptWords = chapterCount * chapterWords;
  const revisedWords = Math.round(chapterCount * 0.2) * chapterWords;

  const items = [
    { label: 'Архитектура романа', model: 'gemini-3-8-flash-openai', cost: lineCost('gemini-3-8-flash-openai', 1500, 1900) },
    { label: 'Черновик глав', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', chapterCount * 3000, manuscriptWords) },
    { label: 'Проверка непрерывности', model: 'gemini-3-8-flash-openai', cost: lineCost('gemini-3-8-flash-openai', manuscriptWords, 300) },
    { label: 'Проверка канона', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', manuscriptWords + 1000, 400) },
    { label: 'Red team (1)', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', manuscriptWords, 500) },
    { label: 'Правки по критике', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', revisedWords, revisedWords) },
    { label: 'Red team (2)', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', manuscriptWords, 500) },
    { label: 'Литературная редактура', model: 'gemini-3-pro', cost: lineCost('gemini-3-pro', manuscriptWords, 400) },
    { label: 'Точечные проверки', model: 'gpt-5-6-luna', cost: lineCost('gpt-5-6-luna', manuscriptWords * 2 + 500, 600) },
    { label: 'Финальная вычитка', model: 'gpt-5-6-luna', cost: lineCost('gpt-5-6-luna', manuscriptWords, manuscriptWords) },
  ];

  const subtotalUsd = items.reduce((s, i) => s + i.cost, 0);
  // Retries, re-reads and higher-than-assumed tokenization all push real
  // spend up — see the earlier discussion; 3x covers the realistic range.
  const lowUsd = subtotalUsd;
  const highUsd = subtotalUsd * 3;

  return {
    chapterCount,
    manuscriptWords,
    items: items.map((i) => ({ ...i, cost: Math.round(i.cost * 100) / 100 })),
    lowUsd: Math.round(lowUsd * 100) / 100,
    highUsd: Math.round(highUsd * 100) / 100,
    lowCredits: Math.round(lowUsd * CREDITS_PER_USD),
    highCredits: Math.round(highUsd * CREDITS_PER_USD),
  };
}

module.exports = { estimateCost };
