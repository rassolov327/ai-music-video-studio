// ---- one-off: draft a /TV "формат" template from real reference episodes ----
// NOT part of the weekly pipeline — run manually once, or re-run only if the reference
// episode set changes. Uses Gemini's video understanding on public YouTube URLs directly
// (no download/upload needed) — free-tier eligible, same GEMINI_API_KEY the server already
// uses. Output is a DRAFT: Костян's own viewing notes are the source of truth wherever they
// disagree with the model's read (see CLAUDE.md's "Show format analysis" section).
//
// Usage:
//   GEMINI_API_KEY=... node scripts/analyze-show-format.js
// (or just `node scripts/analyze-show-format.js` if GEMINI_API_KEY is already exported)
//
// Writes the result to scripts/show-format-draft.json for reconciliation.

import fs from 'fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.6-flash'; // keep in sync with server.js's GEMINI_MODEL
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Three real, consecutive-week "Мир компьютера" episodes (СТС-6 канал, summer 2002) —
// same three Костян should watch himself, so the two passes reconcile against the same
// source material. Swap these if a better/cleaner reference set turns up.
const EPISODE_URLS = [
  'https://www.youtube.com/watch?v=HP3Qs4sbrBU', // 28.06.2002
  'https://www.youtube.com/watch?v=wR27UEbLjnE', // 04.07.2002
  'https://www.youtube.com/watch?v=VI797LxEM6M', // 11.07.2002
];

// One episode per request — a single request covering all three full episodes at once
// (the original approach here) turned out to make Gemini return only one episode's worth
// of segments, with an invented placeholder filename instead of the real URL, presumably
// because producing a detailed segment-by-segment breakdown for ~75 minutes of combined
// footage in one response is a lot to hold onto. Per-episode requests are slower (three
// round-trips) but each one gets the model's full attention, and a failure on one episode
// doesn't take down the other two.
function buildPrompt(videoUrl) {
  return `You are analyzing archival footage of a Russian TV show ("Мир компьютера" /
"PROкомпьютер") to extract its structural format, for use as a template for an automated
weekly re-creation of the show. This is the video at ${videoUrl}.

Produce a timestamped breakdown of THIS video:
- Every segment boundary (in seconds from the start) and what kind of segment it is:
  intro/jingle, rapid-fire news roundup ("Hot line"-style, several short items back to
  back), single-topic deep-dive rubric segment, transition/bumper, outro.
- Which rubric a rubric segment belongs to, if identifiable (Новости / Игры / Софт /
  Интернет / Мобильный мир / other — name it).
- The approximate duration of each segment, in seconds.
- How the transition INTO and OUT OF each segment looks/sounds (jingle only? host speaks
  to camera first? hard cut? some other bumper style?) — describe briefly.
- Any other structural detail worth noting for a template (e.g. whether the anchor is
  on-camera for the whole segment vs. only opening/closing it with cutaway footage in
  between).
- Total episode runtime in seconds.

Be precise about timestamps — use the video's actual timeline, don't estimate blindly. If a
boundary is unclear, say so rather than guessing a specific second.

Reply with ONLY the JSON described by the response schema, nothing else.`;
}

const responseSchema = {
  type: 'object',
  properties: {
    totalRuntimeSec: { type: 'number' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          segmentType: { type: 'string' },
          rubric: { type: 'string' },
          transitionIn: { type: 'string' },
          transitionOut: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['startSec', 'endSec', 'segmentType'],
      },
    },
  },
  required: ['segments'],
};

async function analyzeOneEpisode(videoUrl) {
  const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(videoUrl) }, { fileData: { fileUri: videoUrl } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error('Gemini request failed: ' + JSON.stringify(data));
  }
  const candidate = data && data.candidates && data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) {
    throw new Error('Gemini returned no usable text (finishReason: ' + (candidate && candidate.finishReason) + '). Full response: ' + JSON.stringify(data));
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Gemini output was not valid JSON. Raw text:\n' + text);
  }
  return { videoUrl, totalRuntimeSec: parsed.totalRuntimeSec, segments: parsed.segments || [] };
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Export it first, e.g.:\n  GEMINI_API_KEY=... node scripts/analyze-show-format.js');
    process.exit(1);
  }

  const episodes = [];
  const errors = [];
  for (const url of EPISODE_URLS) {
    console.log('Analyzing ' + url + ' — this can take a minute or two for video understanding...');
    try {
      const episode = await analyzeOneEpisode(url);
      console.log('  -> ' + episode.segments.length + ' segments, ' + episode.totalRuntimeSec + 's total runtime');
      episodes.push(episode);
    } catch (err) {
      console.error('  -> FAILED: ' + err.message);
      errors.push({ videoUrl: url, error: err.message });
    }
  }

  const outPath = new URL('./show-format-draft.json', import.meta.url);
  await fs.writeFile(outPath, JSON.stringify({ episodes, errors }, null, 2));
  console.log('\nDraft written to scripts/show-format-draft.json (' + episodes.length + '/' + EPISODE_URLS.length + ' episodes succeeded) — reconcile against Костян\'s own viewing notes before turning it into the final format template.');
  if (errors.length) {
    console.log('Re-run the script to retry — only failed episodes matter, but this version re-does all three each run (fine for a one-off analysis).');
  }
}

main().catch((err) => {
  console.error('analyze-show-format.js failed:', err);
  process.exit(1);
});
