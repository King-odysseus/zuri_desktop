import assert from 'node:assert/strict';
import { FORMATTING_RULES, plainDashes, withFormattingRules } from '../src/text.js';

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

console.log('PASS reply house style rewrites dashes and leaves code alone');
