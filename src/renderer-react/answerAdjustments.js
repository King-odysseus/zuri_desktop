/**
 * The one-press rewrites offered under the newest reply.
 *
 * Both surfaces draw this row: the desktop transcript and the cloud chat in the
 * browser. Keeping the list in one module is the point, not tidiness. The web chat
 * shipped for weeks without these four buttons because the list lived inside the
 * desktop panel, where the browser could not see it. A surface that imports this
 * list cannot quietly lose one again, and a fifth rewrite added here appears on
 * both without a second edit.
 *
 * `field` and `value` name the saved settings each rewrite corresponds to, so the
 * desktop can offer to make a habit its default. They are not sent with the
 * message; `text` is.
 */
export const QUICK_ADJUSTMENTS = [
  { label: 'Shorter', text: 'Rewrite the same answer, shorter.', field: 'answerLength', value: 'concise' },
  { label: 'More detail', text: 'Rewrite the same answer with more detail.', field: 'answerLength', value: 'detailed' },
  { label: 'Explain simply', text: 'Rewrite the same answer in simpler words.', field: 'answerDetail', value: 'simple' },
  { label: 'As a table', text: 'Show the same answer as a table.', field: 'answerLayout', value: 'structured' },
];
