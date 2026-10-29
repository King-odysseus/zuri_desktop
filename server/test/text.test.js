import assert from 'node:assert/strict';
import { ANSWER_RULES, FORMATTING_RULES, MODEL_NOTES, ZURI_IDENTITY, answerStyleLength, plainDashes, withAnswerStyle, withFormattingRules, withZuriIdentity } from '../src/text.js';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// A prose dash becomes a plain hyphen, and nothing typographic is left behind.
assert.equal(plainDashes(`one ${EM} two`), 'one - two', 'an em dash becomes a hyphen');
assert.equal(plainDashes(`one${EM}two`), 'one-two', 'a closed-up em dash becomes a hyphen');
assert.equal(plainDashes(`one ${EN} two`), 'one - two', 'an en dash becomes a hyphen');

// A number range keeps its meaning: no spaces appear around the rewritten dash.
assert.equal(plainDashes(`2024${EN}2026`), '2024-2026', 'a numeric range stays a range');
assert.equal(plainDashes(`10 ${EM} 20`), '10-20', 'a spaced numeric range closes up');

// Code is the program's own content, so it is handed back byte for byte.
assert.equal(
  plainDashes('```js\nconst title = `a ' + EM + ' b`;\n```'),
  '```js\nconst title = `a ' + EM + ' b`;\n```',
  'a fenced block is untouched',
);
assert.equal(plainDashes('`a ' + EM + ' b` and a ' + EM + ' b'), '`a ' + EM + ' b` and a - b', 'inline code is untouched, prose is not');

// Nothing to do is not an error, and neither is a non-string.
assert.equal(plainDashes(''), '');
assert.equal(plainDashes(null), '');
assert.equal(plainDashes('plain - text'), 'plain - text', 'an already plain hyphen is left alone');

// The rule rides with the conversation exactly once, ahead of what the client sent.
const messages = [{ role: 'user', content: 'Hello' }];
const ruled = withFormattingRules(messages);
assert.equal(ruled.length, 2, 'the rule adds one turn');
assert.equal(ruled[0].role, 'system');
assert.equal(ruled[0].content, FORMATTING_RULES);
assert.equal(ruled[1].content, 'Hello', 'the customer turn is unchanged');
assert.equal(withFormattingRules(ruled), ruled, 'a conversation that already carries the rule is not given a second copy');

// A client that already sent its own copy is respected rather than duplicated.
const ownCopy = [{ role: 'system', content: 'Never use em dashes. Be brief.' }, { role: 'user', content: 'Hi' }];
assert.equal(withFormattingRules(ownCopy), ownCopy, 'an existing rule is not duplicated');

// Web and phone chats are told they are Zuri, once; the desktop's own longer line is respected.
const named = withZuriIdentity([{ role: 'user', content: 'Who are you?' }]);
assert.equal(named.length, 2, 'the identity adds one turn');
assert.equal(named[0].content, ZURI_IDENTITY);
assert.equal(withZuriIdentity(named), named, 'a conversation that already carries the identity is not given a second copy');
const desktopOwn = [{ role: 'system', content: 'You are Zuri, an AI assistant made by Tijha. More rules.' }, { role: 'user', content: 'Hi' }];
assert.equal(withZuriIdentity(desktopOwn), desktopOwn, 'the desktop identity is not duplicated');

// Every model gets the answer rules; each supplier adds its own short note, once.
for (const supplier of ['deepseek', 'moonshot', 'zai', 'openai', 'anthropic']) {
  const styled = withAnswerStyle([{ role: 'user', content: 'Hi' }], supplier);
  assert.equal(styled.length, 2, supplier + ' gets one extra turn');
  assert.ok(styled[0].content.startsWith(ANSWER_RULES), supplier + ' carries the shared rules');
  assert.ok(styled[0].content.endsWith(MODEL_NOTES[supplier]), supplier + ' carries its own note');
  assert.equal(styled[0].content.length, answerStyleLength(supplier), supplier + ' is counted exactly');
  assert.equal(withAnswerStyle(styled, supplier), styled, supplier + ' is not given a second copy');
}
// The desktop's own style block is kept; only the supplier note is added to it.
const fromDesktop = withAnswerStyle([{ role: 'system', content: 'How to write this reply: short.' }, { role: 'user', content: 'Hi' }], 'deepseek');
assert.equal(fromDesktop.length, 3);
assert.equal(fromDesktop[0].content, MODEL_NOTES.deepseek, 'the desktop gets the note without a second set of rules');
const unknownSupplier = withAnswerStyle([{ role: 'user', content: 'Hi' }], 'someone-new');
assert.equal(unknownSupplier[0].content, ANSWER_RULES, 'an unlisted supplier gets the shared rules only');
assert.equal(answerStyleLength('someone-new'), ANSWER_RULES.length);
assert.ok(!/[‒-―]/.test(ANSWER_RULES + Object.values(MODEL_NOTES).join('')), 'the rules follow their own no-dash style');

console.log('PASS reply house style rewrites dashes and leaves code alone');
