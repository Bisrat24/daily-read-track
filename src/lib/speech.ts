// Natural-sounding read-aloud engine on top of the Web Speech API.
//
// Two things make browser TTS sound robotic: speaking one word (or chunk) per
// utterance, and cancelling/restarting between them. This engine instead speaks
// whole *sentences*, keeps the next sentence queued so the voice never stops
// mid-paragraph, and drives the on-screen highlight from `onboundary` events so
// the reader tracks the voice word-by-word without any restart.

export type Sentence = {
  start: number; // word index (inclusive)
  end: number; // word index (exclusive)
  text: string;
  /** Char offset inside `text` for each word, used to map boundary events. */
  charStarts: number[];
};

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const ABBREVIATION = /^(mr|mrs|ms|dr|prof|st|sr|jr|vs|etc|e\.g|i\.e|no|fig|vol|ch)\.?$/i;

/**
 * Group words into sentences. Long sentences are split at commas / semicolons
 * so a single utterance never runs so long that seeking feels laggy.
 */
export function buildSentences(words: string[], maxWords = 28): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const push = (end: number) => {
    if (end <= start) return;
    const slice = words.slice(start, end);
    const charStarts: number[] = [];
    let pos = 0;
    for (const w of slice) {
      charStarts.push(pos);
      pos += w.length + 1;
    }
    out.push({ start, end, text: slice.join(" "), charStarts });
    start = end;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const len = i - start + 1;
    const hardEnd = SENTENCE_END.test(w) && !ABBREVIATION.test(w);
    const softEnd = len >= maxWords - 8 && /[,;:—]$/.test(w);
    if ((hardEnd && len >= 3) || softEnd || len >= maxWords) push(i + 1);
  }
  push(words.length);
  return out;
}

export function sentenceIndexFor(sentences: Sentence[], wordIdx: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sentences[mid].start <= wordIdx) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

// ---- Voice selection --------------------------------------------------------

export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

/** Score voices so the most human-sounding English voice wins. */
export function pickNaturalVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length ? english : voices;
  if (!pool.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    const n = `${v.name} ${v.voiceURI}`.toLowerCase();
    let s = 0;
    if (/natural|neural|premium|enhanced|siri|wavenet|studio/.test(n)) s += 60;
    if (/google/.test(n)) s += 40;
    if (/microsoft/.test(n)) s += 20;
    if (!v.localService) s += 15; // cloud voices are usually the good ones
    if (/compact|espeak|robot|novelty|fred|albert|zarvox/.test(n)) s -= 60;
    if (/en-us|en-gb/i.test(v.lang)) s += 5;
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Resolve the voice to use from a stored voiceURI ("" = auto). */
export function resolveVoice(voiceURI: string): SpeechSynthesisVoice | null {
  const voices = listVoices();
  if (voiceURI) {
    const match = voices.find((v) => v.voiceURI === voiceURI);
    if (match) return match;
  }
  return pickNaturalVoice(voices);
}

/** Wait until the browser has populated its voice list (async on Chrome). */
export function whenVoicesReady(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.speechSynthesis) return () => {};
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) {
    cb();
    return () => {};
  }
  const handler = () => cb();
  synth.addEventListener("voiceschanged", handler);
  return () => synth.removeEventListener("voiceschanged", handler);
}

// ---- Speaker ----------------------------------------------------------------

export type SpeakerOptions = {
  sentences: Sentence[];
  from: number; // starting word index
  rate: number;
  pitch: number;
  voiceURI: string;
  /** Called continuously as the voice moves across words. */
  onWord: (wordIdx: number) => void;
  onFinish: () => void;
};

/**
 * Speaks from `from` to the end of the book, keeping one sentence pre-queued so
 * the transition between sentences is gapless. Returns a stop() function.
 */
export function startSpeaking(opts: SpeakerOptions): () => void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts.onFinish();
    return () => {};
  }
  const synth = window.speechSynthesis;
  const { sentences } = opts;
  let stopped = false;
  let next = sentenceIndexFor(sentences, opts.from);
  let queued = 0;
  const voice = resolveVoice(opts.voiceURI);

  // Tiny per-sentence variation keeps long passages from sounding metronomic.
  let jitterSeed = next;
  const jitter = () => {
    jitterSeed = (jitterSeed * 1103515245 + 12345) & 0x7fffffff;
    return ((jitterSeed % 1000) / 1000 - 0.5) * 0.04; // ±0.02
  };

  const enqueue = () => {
    if (stopped || next >= sentences.length) return;
    const s = sentences[next];
    // First utterance may start mid-sentence (after a manual seek).
    const startWord = next === sentenceIndexFor(sentences, opts.from) && opts.from > s.start
      ? opts.from
      : s.start;
    const offset = startWord - s.start;
    const text = offset > 0 ? s.text.slice(s.charStarts[offset] ?? 0) : s.text;
    next += 1;
    if (!text.trim()) {
      enqueue();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = Math.min(2, Math.max(0.5, opts.rate + jitter()));
    u.pitch = Math.min(2, Math.max(0, opts.pitch + jitter()));
    u.volume = 1;
    const baseChar = offset > 0 ? (s.charStarts[offset] ?? 0) : 0;

    u.onstart = () => {
      if (!stopped) opts.onWord(startWord);
    };
    u.onboundary = (e) => {
      if (stopped || e.name === "sentence") return;
      const abs = baseChar + (e.charIndex ?? 0);
      // charStarts is ascending — walk from the known start word.
      let w = s.charStarts.length - 1;
      for (let k = offset; k < s.charStarts.length; k++) {
        if (s.charStarts[k] > abs) {
          w = Math.max(offset, k - 1);
          break;
        }
        w = k;
      }
      opts.onWord(s.start + w);
    };
    const done = () => {
      if (stopped) return;
      queued = Math.max(0, queued - 1);
      if (next < sentences.length) enqueue();
      else if (queued === 0) opts.onFinish();
    };
    u.onend = done;
    u.onerror = done;
    queued += 1;
    synth.speak(u);
  };

  synth.cancel();
  // Prime two sentences so playback is continuous from the first transition.
  enqueue();
  enqueue();

  return () => {
    stopped = true;
    try {
      synth.cancel();
    } catch {
      /* ignore */
    }
  };
}
