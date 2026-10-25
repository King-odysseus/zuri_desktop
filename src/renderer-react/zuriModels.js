/**
 * The six chat models Zuri sells, in one place.
 *
 * Settings and the composer both offer this list, and they must never disagree
 * about which supplier id sits behind a Zuri name: a picker row whose id belongs
 * to another provider would answer with a different model than the name promises,
 * because providers/chat.js swaps a foreign id for the provider's default.
 *
 * Each row still carries the real supplier id, because that is what the provider
 * API is asked for and what providers/chat.js checks the saved model against. The
 * provider travels with the model because a supplier id is only valid on its own
 * API, so choosing a model also chooses the key that pays for it.
 *
 * The renderer owns the names because it cannot import main-process code; the
 * selftest checks every row here against resolveChatTarget in chat.js.
 */
export const ZURI_MODELS = [
  { provider: 'deepseek', model: 'deepseek-flash', name: 'Zuri Flash', note: 'Cheap and quick for everyday questions.' },
  { provider: 'moonshot', model: 'kimi-k3', name: 'Zuri Pro', note: 'Balanced, and good with long documents.' },
  { provider: 'zai', model: 'glm-5.3', name: 'Zuri Max', note: 'Strong general reasoning.' },
  { provider: 'openai', model: 'gpt-6.1-sol', name: 'Zuri Core', note: 'A current, well-rounded model for careful work.' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', name: 'Zuri Reason', note: 'Careful step-by-step analysis.' },
  { provider: 'anthropic', model: 'claude-opus-5-5', name: 'Zuri Elite', note: 'The deepest answers, and the dearest.' },
];

/**
 * The catalogue row for a supplier model id, or null when the id is not ours.
 *
 * A settings file written by an older build, or one edited by hand, can carry an
 * id outside this list. Callers fall back to showing the id rather than throwing:
 * a chat must still be answerable after the catalogue changes.
 * @param {unknown} modelId
 * @returns {{ provider: string, model: string, name: string, note: string } | null}
 */
export function zuriModelFor(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') return null;
  const wanted = modelId.trim();
  return ZURI_MODELS.find((entry) => entry.model === wanted) ?? null;
}

/**
 * Zuri codes whose name is not the code with capitals on it.
 *
 * The chip reads whatever Settings holds, and that can be a Zuri code rather than a
 * supplier id. The fallback below spells an unknown code out, so a saved 'zuri-code'
 * would show "Zuri Code" and quietly bring back the retired name. A row whose code no
 * longer matches its name belongs here.
 */
const RENAMED_CODES = Object.freeze({ 'zuri-code': 'Zuri Core' });

/**
 * The Zuri name for whatever model id Settings holds, for the composer's chip.
 *
 * A person must never meet a supplier id in this app. A settings file written by an
 * older build holds ids like gpt-4o that this catalogue does not list, and the cloud
 * answers an id it does not recognise with Zuri Flash, so that is the honest name for
 * one. A Zuri code the catalogue has not caught up with is still sent to the cloud as
 * itself, so it is shown as a name (zuri-ultra becomes Zuri Ultra).
 * @param {unknown} modelId
 * @returns {string} A Zuri name, or '' when nothing is saved.
 */
export function zuriModelName(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') return '';
  const wanted = modelId.trim();
  const known = zuriModelFor(wanted);
  if (known !== null) return known.name;
  const renamed = RENAMED_CODES[wanted.toLowerCase()];
  if (renamed !== undefined) return renamed;
  if (/^zuri-[a-z0-9-]+$/i.test(wanted)) {
    return wanted.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return 'Zuri Flash';
}
