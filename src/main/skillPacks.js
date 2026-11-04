/**
 * skillPacks.js - the shareable file a person can hand to someone else.
 *
 * A skill is plain text: a name and instructions that are added to every reply
 * while it is switched on. That makes a set of them worth sharing ("our house
 * style", "how we write client emails"), and a pack is just those skills in one
 * small JSON file.
 *
 * Two decisions are deliberate.
 *
 * 1. An imported skill always starts switched off. The instructions in a file
 *    someone else wrote go into the prompt of every message once enabled, so they
 *    have to be read before they take effect. Importing a pack changes nothing
 *    until the person flips the switches themselves.
 *
 * 2. A pack carries no ids. Ids belong to one machine's skills.json, so copying
 *    them would collide with a skill already saved here. Import compares names
 *    instead, which is what makes importing the same file twice a no-op rather
 *    than a pile of duplicates.
 *
 * This module is pure: text in, objects out, no file system and no Electron. That
 * is what lets scripts/selftest.js drive it, and it keeps the rules in one place
 * instead of spread between the dialog and the page.
 */

import { SKILL_INSTRUCTIONS_MAX_LENGTH, SKILL_MAX_COUNT, SKILL_NAME_MAX_LENGTH } from './store.js';

/** The format tag, so a future change to the shape can refuse an old file cleanly. */
export const SKILL_PACK_FORMAT = 'zuri-skill-pack';
export const SKILL_PACK_VERSION = 1;

/** A pack larger than this is not a list of instructions anyone typed by hand. */
export const SKILL_PACK_MAX_BYTES = 200_000;

/** Enough for more than one person's skill list without letting a file flood the store. */
const SKILL_PACK_MAX_ENTRIES = 60;

/**
 * Text for one skill, cut to the same limits `createSkill` enforces.
 * @param {unknown} entry
 * @returns {{ name: string, instructions: string } | null} null when it cannot be a skill.
 */
function readSkillEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const name = typeof entry.name === 'string' ? entry.name.replace(/\s+/g, ' ').trim().slice(0, SKILL_NAME_MAX_LENGTH) : '';
  const instructions =
    typeof entry.instructions === 'string' ? entry.instructions.trim().slice(0, SKILL_INSTRUCTIONS_MAX_LENGTH) : '';
  if (name === '' || instructions === '') return null;
  return { name, instructions };
}

/**
 * Build the file for a set of skills.
 * @param {Array<{ name?: string, instructions?: string }>} skills
 * @param {{ packName?: string, now?: Date }} [options]
 * @returns {{ ok: true, data: { text: string, count: number } } | { ok: false, error: { code: string, message: string } }}
 */
export function buildSkillPack(skills, options = {}) {
  const entries = (Array.isArray(skills) ? skills : []).map(readSkillEntry).filter((entry) => entry !== null);

  if (entries.length === 0) {
    return { ok: false, error: { code: 'SKILL_PACK_EMPTY', message: 'There are no skills to share yet.' } };
  }
  if (entries.length > SKILL_PACK_MAX_ENTRIES) {
    return {
      ok: false,
      error: { code: 'SKILL_PACK_TOO_LARGE', message: `A pack can hold up to ${SKILL_PACK_MAX_ENTRIES} skills.` },
    };
  }

  const packName = typeof options.packName === 'string' && options.packName.trim() !== '' ? options.packName.trim().slice(0, 80) : 'My skills';
  const now = options.now instanceof Date ? options.now : new Date();

  // `enabled` is not written. A pack that recorded it would let a file switch
  // instructions on as it opened, which is the one thing importing must not do.
  const pack = {
    format: SKILL_PACK_FORMAT,
    version: SKILL_PACK_VERSION,
    name: packName,
    exportedAt: now.toISOString(),
    skills: entries.map((entry) => ({ name: entry.name, instructions: entry.instructions })),
  };

  const text = `${JSON.stringify(pack, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > SKILL_PACK_MAX_BYTES) {
    return {
      ok: false,
      error: { code: 'SKILL_PACK_TOO_LARGE', message: 'That pack is larger than 200 KB. Share fewer skills per file.' },
    };
  }

  return { ok: true, data: { text, count: entries.length } };
}

/**
 * Read a pack file.
 *
 * Every failure names what is wrong with the file rather than saying "invalid",
 * because the person's next step is usually to ask the sender for a fresh copy.
 * @param {unknown} text
 * @returns {{ ok: true, data: { name: string, skills: Array<{ name: string, instructions: string }>, skipped: number } } | { ok: false, error: { code: string, message: string } }}
 */
export function parseSkillPack(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: { code: 'SKILL_PACK_INVALID', message: 'That file is empty.' } };
  }
  if (Buffer.byteLength(text, 'utf8') > SKILL_PACK_MAX_BYTES) {
    return { ok: false, error: { code: 'SKILL_PACK_TOO_LARGE', message: 'That file is larger than 200 KB, so it is not a skill pack.' } };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'SKILL_PACK_INVALID', message: 'That file is not a skill pack. Choose the .json file Zuri exported.' } };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: { code: 'SKILL_PACK_INVALID', message: 'That file is not a skill pack.' } };
  }
  if (parsed.format !== SKILL_PACK_FORMAT) {
    return { ok: false, error: { code: 'SKILL_PACK_INVALID', message: 'That file is not a skill pack exported by Zuri.' } };
  }
  if (parsed.version !== SKILL_PACK_VERSION) {
    return {
      ok: false,
      error: {
        code: 'SKILL_PACK_VERSION',
        message: 'That pack was written by a newer version of Zuri. Update Zuri and try again.',
      },
    };
  }
  if (!Array.isArray(parsed.skills)) {
    return { ok: false, error: { code: 'SKILL_PACK_INVALID', message: 'That pack has no skills in it.' } };
  }

  const raw = parsed.skills.slice(0, SKILL_PACK_MAX_ENTRIES);
  const skills = [];
  const seen = new Set();
  let skipped = parsed.skills.length - raw.length;

  for (const entry of raw) {
    const skill = readSkillEntry(entry);
    if (skill === null) {
      skipped += 1;
      continue;
    }
    // Two entries with one name would make the list read as a duplicate bug.
    const key = skill.name.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    skills.push(skill);
  }

  if (skills.length === 0) {
    return {
      ok: false,
      error: { code: 'SKILL_PACK_EMPTY', message: 'That pack has no skills with both a name and instructions.' },
    };
  }

  const name = typeof parsed.name === 'string' && parsed.name.trim() !== '' ? parsed.name.trim().slice(0, 80) : 'Skill pack';
  return { ok: true, data: { name, skills, skipped } };
}

/**
 * Which skills of a pack are not already saved, and how many there is room for.
 *
 * Split out from the import itself so the page can say "3 new, 2 already saved"
 * before anything is written.
 * @param {Array<{ name: string }>} imported
 * @param {Array<{ name?: string }>} existing
 * @returns {{ fresh: Array<{ name: string, instructions: string }>, duplicates: number, overLimit: number }}
 */
export function planSkillImport(imported, existing) {
  const names = new Set(
    (Array.isArray(existing) ? existing : [])
      .map((skill) => (typeof skill?.name === 'string' ? skill.name.trim().toLowerCase() : ''))
      .filter((name) => name !== ''),
  );

  const fresh = [];
  let duplicates = 0;
  let overLimit = 0;

  for (const skill of Array.isArray(imported) ? imported : []) {
    if (names.has(skill.name.toLowerCase())) {
      duplicates += 1;
      continue;
    }
    if (names.size + fresh.length >= SKILL_MAX_COUNT) {
      overLimit += 1;
      continue;
    }
    names.add(skill.name.toLowerCase());
    fresh.push(skill);
  }

  return { fresh, duplicates, overLimit };
}

/**
 * A filename for the save dialog. Windows refuses a colon, and a pack name can
 * contain one ("Style: formal"), so the name is reduced to what a file system
 * accepts on every platform.
 * @param {string} packName
 * @returns {string}
 */
export function packFileName(packName) {
  const base = String(packName ?? '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base === '' ? 'zuri-skill-pack' : base}.zuri-skills.json`;
}
