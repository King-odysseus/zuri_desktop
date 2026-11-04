/**
 * speech.js - read a reply aloud with the voice the device already has.
 *
 * The desktop window and the browser chat both use this, so the two cannot word or
 * behave differently. It uses the built-in speechSynthesis of the browser engine:
 * nothing is sent to a server and no paid voice service is involved, so it adds no
 * cost. Where the engine has no voices the button is simply not offered.
 */

/** One utterance per chunk: engines cut off or stall on a very long single utterance. */
const CHUNK_LIMIT = 220;

/** A reply longer than this is read up to here; nobody wants ten minutes of speech by accident. */
const SPEECH_LIMIT = 6000;

/** Whether this engine can speak at all. */
export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

/**
 * Markdown as it should sound: the words, without the symbols a voice would read out
 * ("asterisk asterisk"), and without code blocks, which are noise when spoken.
 * @param {unknown} markdown
 * @returns {string}
 */
export function speakableText(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  return source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|?[-: |]{3,}\|?\s*$/gm, ' ')
    .replace(/\|/g, ', ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\[(\d+)\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPEECH_LIMIT);
}

/**
 * Split on sentence ends so each piece is short, keeping whole sentences together
 * where they fit.
 * @param {string} text
 * @returns {string[]}
 */
export function speechChunks(text) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current !== '' && current.length + sentence.length > CHUNK_LIMIT) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
    // A sentence with no stop in it can still be too long: break it on spaces.
    while (current.length > CHUNK_LIMIT * 2) {
      const cut = current.lastIndexOf(' ', CHUNK_LIMIT);
      const at = cut > 0 ? cut : CHUNK_LIMIT;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at);
    }
  }
  if (current.trim() !== '') chunks.push(current.trim());
  return chunks.filter((chunk) => chunk !== '');
}

/** Ends the reply being read now, if any. Safe to call when nothing is playing. */
export function stopSpeaking() {
  if (speechAvailable()) window.speechSynthesis.cancel();
}

/**
 * Read `markdown` aloud, replacing anything already being read.
 * @param {string} markdown
 * @param {{ onEnd?: () => void }} [options] Called once, whether the reading finished or was stopped.
 * @returns {boolean} False when there was nothing to say or no voice to say it with.
 */
export function speak(markdown, { onEnd } = {}) {
  if (!speechAvailable()) return false;
  const chunks = speechChunks(speakableText(markdown));
  if (chunks.length === 0) return false;

  const synth = window.speechSynthesis;
  synth.cancel();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };
  chunks.forEach((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    // An interrupted or failed utterance ends the whole reading, so the button
    // never stays stuck on "Stop" after the engine gave up.
    utterance.onerror = finish;
    if (index === chunks.length - 1) utterance.onend = finish;
    synth.speak(utterance);
  });
  return true;
}
