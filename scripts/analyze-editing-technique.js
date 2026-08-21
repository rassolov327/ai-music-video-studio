// ---- one-off: build a few-shot "editing technique" example bank for the /TV virtual
// editor (Studios Stage C — see CLAUDE.md's "Studios + virtual editor" section) ----
// NOT part of the weekly pipeline — run manually once against a curated set of episodes
// from SEVERAL DIFFERENT real shows (not the 3 same-show reference episodes already used
// for segment TIMING in analyze-show-format.js — this is about cutting/shot-selection
// judgment instead, a different analytical lens, even when a source episode overlaps).
// Same mechanism as analyze-show-format.js: Gemini video understanding directly on public
// YouTube URLs, no download/upload needed, same GEMINI_API_KEY the server already uses.
//
// Output is a FEW-SHOT BANK, not a rigid rule list (Костян's explicit choice, 2026-08-20):
// concrete worked fragments — "this narration text, this duration -> this real sequence of
// shots" — pulled straight from real episodes, for Stage D to retrieve/attach into its own
// prompt and reason by analogy, the way a real director works from experience rather than a
// formula.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/analyze-editing-technique.js
//
// Writes the result to scripts/editing-technique-bank.json.

import fs from 'fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.6-flash'; // keep in sync with server.js's GEMINI_MODEL
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Костян's picks, sent one at a time in chat and confirmed 2026-08-20. The third
// deliberately reuses a segment-timing reference episode (HP3Qs4sbrBU) for a second,
// different analytical pass — not a mistake, confirmed explicitly.
const EPISODE_URLS = [
  'https://www.youtube.com/watch?v=OLHT4ZrJRjE',
  'https://www.youtube.com/watch?v=wfZuvZiU4Qk',
  'https://www.youtube.com/watch?v=HP3Qs4sbrBU',
];

// One episode per request — same reasoning as analyze-show-format.js: a single request
// covering multiple full episodes risks the model losing detail/attention across the
// combined length. Per-episode requests are slower but each gets full attention, and one
// failure doesn't take down the others.
function buildPrompt(videoUrl) {
  return `You are analyzing archival TV footage to build a training example bank of real
editing/directing decisions, for use by an automated video editor that will later cut similar
talking-head segments on its own. This is the video at ${videoUrl}.

Find distinct moments where a host/presenter/narrator is speaking on camera for a continuous
stretch — a "talking segment" (this is the exact situation the automated editor will face
later: one continuous piece of narration that needs to be cut into a sequence of real shots).
Spread your selection across the WHOLE episode, not just the first few minutes — find up to
15 such segments total.

For EACH talking segment found, report:
- An approximate transcription of what is said during it (doesn't need to be word-perfect,
  best effort from the audio).
- The segment's total duration in seconds.
- The REAL sequence of shots actually used to cover it — for each shot: its shot size (one
  of: Extreme Wide Shot, Wide Shot, Medium Wide Shot, Medium Shot, Medium Close-Up, Close-Up,
  Extreme Close-Up, Detail Shot), what it shows (e.g. "host on camera", "host's hands on an
  object", "a screen/monitor", "an inserted product shot"), any camera movement (Static, Push
  In, Pull Out, Steadicam, Crane — or "none" if genuinely static), and that individual shot's
  own approximate duration in seconds.

Only include segments with real host/narrator speech and an actual cutting decision to learn
from — skip pure jingles, music-only stretches, or b-roll with no narration over it. Be
precise about timestamps and durations — read them from the video's actual timeline, don't
estimate blindly.

Reply with ONLY the JSON described by the response schema, nothing else.`;
}

const responseSchema = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: { type: 'number' },
          durationSec: { type: 'number' },
          narrationText: { type: 'string' },
          shots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                shotSize: { type: 'string' },
                subject: { type: 'string' },
                cameraMove: { type: 'string' },
                durationSec: { type: 'number' },
              },
              required: ['shotSize', 'subject', 'durationSec'],
            },
          },
        },
        required: ['startSec', 'durationSec', 'narrationText', 'shots'],
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
  return { videoUrl, segments: parsed.segments || [] };
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Export it first, e.g.:\n  GEMINI_API_KEY=... node scripts/analyze-editing-technique.js');
    process.exit(1);
  }

  const episodes = [];
  const errors = [];
  for (const url of EPISODE_URLS) {
    console.log('Analyzing ' + url + ' — this can take a minute or two for video understanding...');
    try {
      const episode = await analyzeOneEpisode(url);
      console.log('  -> ' + episode.segments.length + ' talking segments found');
      episodes.push(episode);
    } catch (err) {
      console.error('  -> FAILED: ' + err.message);
      errors.push({ videoUrl: url, error: err.message });
    }
  }

  // Flatten into one example bank — Stage D retrieves/attaches individual fragments, not
  // whole episodes, so the per-episode grouping doesn't need to survive into the bank
  // itself. sourceVideoUrl + startSec are kept on each fragment so a fragment can always be
  // traced back to its real source for spot-checking.
  const bank = [];
  for (const episode of episodes) {
    for (const seg of episode.segments) {
      bank.push({ sourceVideoUrl: episode.videoUrl, ...seg });
    }
  }

  const outPath = new URL('./editing-technique-bank.json', import.meta.url);
  await fs.writeFile(outPath, JSON.stringify({ bank, errors }, null, 2));
  console.log('\nBank written to scripts/editing-technique-bank.json (' + bank.length + ' fragments from ' + episodes.length + '/' + EPISODE_URLS.length + ' episodes) — this is a DRAFT, spot-check a few fragments against the real videos before trusting it as Stage D input.');
  if (errors.length) {
    console.log('Re-run the script to retry — only failed episodes matter, but this version re-does all three each run (fine for a one-off analysis).');
  }
}

main().catch((err) => {
  console.error('analyze-editing-technique.js failed:', err);
  process.exit(1);
});
