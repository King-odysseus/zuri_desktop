/**
 * ui/composer.js - the message input and the request it starts.
 *
 * Send is two writes and a stream: the user's text is saved first, then main asks
 * the provider for a reply and pushes tokens back on `chat:stream`. This module
 * paints those tokens into the reply bubble as they arrive, and turns any failure
 * (no key saved, network down, provider refused) into an inline error bubble in the
 * transcript rather than a console message or a silent no-op: the user's own
 * message is already saved, so an error turn is the honest next thing to show.
 *
 * It also owns the bubble markup. Everything that puts a message in the transcript
 * builds it here, so a streamed reply, a saved reply and a stored one look the same.
 */

import { enhanceSelect } from './select.js';

/** The reply token channel's time label, when the stored time is unreadable. */
const UNKNOWN_TIME = '';

/** Copy shown when the reply path is unreachable, as in a browser preview. */
const NO_REPLY_PATH = 'Replies need the desktop app. Your message was saved.';

/** What the streaming row says while a reply is on its way (node 0:944). */
const STREAMING_LABEL = 'Zuri is writing';

/**
 * The composer's three lines of copy (node 0:1221). The node draws the prompt in
 * every resting state, a "wait for it" line while a reply streams, and a retry
 * prompt once a reply has failed, so the caret's next action is always named.
 */
const PLACEHOLDER = Object.freeze({
  prompt: 'Ask Zuri anything, or describe a task for it to do…',
  working: 'Zuri is working — wait for it to finish…',
  retry: 'Try again, or switch model…',
});

/**
 * Wall-clock time for one message.
 * @param {string} iso
 * @returns {string}
 */
function formatClock(iso) {
  const then = Date.parse(iso ?? '');
  if (Number.isNaN(then)) return UNKNOWN_TIME;
  return new Date(then).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The three modes a turn can be sent in (node 0:1221's mode badges). */
const MODE_LABELS = Object.freeze({ ask: 'Ask', act: 'Act', autopilot: 'Autopilot' });

/**
 * The modes the selector offers, in the order the design lists them. Each carries a
 * one-line hint, because "Act" alone does not tell someone that Zuri announces a
 * change before making it.
 */
const MODES = Object.freeze([
  { id: 'ask', label: 'Ask', hint: 'Answers, changes nothing' },
  { id: 'act', label: 'Act', hint: 'Changes things, telling you first' },
  { id: 'autopilot', label: 'Autopilot', hint: 'Runs the job on its schedule' },
]);

/**
 * The draft grows a line at a time up to this many, then scrolls (decision 18). Kept
 * here rather than in CSS so the clamp and the line count come from one number: CSS
 * cannot measure a textarea's content height.
 */
const MAX_INPUT_LINES = 8;

/** Models the selector offers; the saved one is added if it is not already listed. */
const MODEL_OPTIONS = Object.freeze([
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
]);

/** The store's default model, used until settings answer. */
const DEFAULT_MODEL = 'gpt-4o';

/**
 * Glyphs from the design's icon set, as lucide path data. Only these constants
 * ever reach an innerHTML call, never message content.
 */
const GLYPH = Object.freeze({
  person:
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  alert:
    '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  retry:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  attach:
    '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
});

/**
 * Build one glyph as inline SVG so it inherits the current text colour.
 * @param {keyof typeof GLYPH} name
 * @param {number} size
 * @returns {SVGSVGElement}
 */
function createGlyph(name, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Inert path constants: no message text is ever interpolated here.
  svg.innerHTML = GLYPH[name] ?? '';
  return svg;
}

/**
 * Zuri's mark, traced from the supplied logo: one filled speech bubble whose two
 * eyes are holes cut by fill-rule, so the tile colour behind shows through them.
 * The viewBox is the bubble plus its tail; the same path is inlined in the shell
 * and the account pages, where no module can build it.
 */
const ZURI_MARK_PATH =
  'M10.2 0H13.8C18.9 0 24 3.9 24 8.6V12.4C24 16.3 22 20.2 20.05 20.2V24L13.8 21.4H9.2C4.6 21.4 0 17.25 0 13.1V8.4C0 4.2 5.1 0 10.2 0ZM5.8 8.3A1.86 1.86 0 0 1 9.5 8.3V13.8A1.86 1.86 0 0 1 5.8 13.8ZM14.3 8.3A1.86 1.86 0 0 1 18.1 8.3V13.8A1.86 1.86 0 0 1 14.3 13.8Z';

/**
 * Zuri's mark as inline SVG in the current text colour.
 * @param {number} size
 * @returns {SVGSVGElement}
 */
function createZuriMark(size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', ZURI_MARK_PATH);
  svg.append(path);
  return svg;
}

/**
 * Which mode a turn was sent in. Stored turns without one read as Ask, the mode
 * the composer starts in, so a badge is never blank.
 * @param {{ mode?: string }} message
 * @returns {'ask' | 'act' | 'autopilot'}
 */
function modeFor(message) {
  const mode = typeof message?.mode === 'string' ? message.mode.toLowerCase() : '';
  return Object.hasOwn(MODE_LABELS, mode) ? mode : 'ask';
}

/**
 * The meta row above a turn: the mode badge, plus the author for Zuri and the
 * avatar for the reader (node 0:1221).
 * @param {'user' | 'assistant'} role
 * @param {any} message
 * @param {string} [initials]
 * @returns {HTMLElement}
 */
function createMetaRow(role, message, initials) {
  const meta = document.createElement('div');
  meta.className = 'message-meta';

  if (role === 'assistant') {
    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = 'Zuri';
    meta.append(author);
  }

  const badge = document.createElement('span');
  badge.className = 'message-badge';
  badge.textContent = message.state === 'failed' ? 'Failed' : MODE_LABELS[modeFor(message)];
  meta.append(badge);

  if (role === 'user') {
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.dataset.role = 'user';
    avatar.setAttribute('aria-label', 'You');
    if (initials) {
      avatar.textContent = initials;
    } else {
      // No name is stored yet, so the circle carries a person rather than made-up
      // initials; the shape and fill are still the node's.
      avatar.append(createGlyph('person', 14));
    }
    meta.append(avatar);
  }

  return meta;
}

/**
 * Zuri's 24 px mark: the bubble, or the alert glyph on a failed turn.
 * @param {boolean} failed
 * @returns {HTMLElement}
 */
function createAssistantAvatar(failed) {
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.dataset.role = 'assistant';
  if (failed) avatar.dataset.state = 'failed';
  avatar.append(failed ? createGlyph('alert', 12) : createZuriMark(14));
  return avatar;
}

/**
 * A file the reader attached, under their bubble (node 0:1221).
 * @param {Array<{ name?: string, state?: string }>} attachments
 * @returns {HTMLElement}
 */
function createAttachmentList(attachments) {
  const list = document.createElement('div');
  list.className = 'message-attachments';

  for (const attachment of attachments) {
    const chip = document.createElement('span');
    chip.className = 'message-attachment';

    const icon = document.createElement('span');
    icon.className = 'message-attachment-icon';
    icon.append(createGlyph('file', 14));
    chip.append(icon);

    const name = document.createElement('span');
    name.className = 'message-attachment-name';
    name.textContent = String(attachment?.name ?? '');
    chip.append(name);

    if (attachment?.state) {
      const state = document.createElement('span');
      state.className = 'message-attachment-state';
      state.textContent = String(attachment.state);
      chip.append(state);
    }

    list.append(chip);
  }

  return list;
}

/**
 * What Act did to a file, inside the reply: the file and sheet with the state
 * badge, then the one change in mono (node 0:1221).
 * @param {{ name?: string, state?: string, detail?: string }} tool
 * @returns {HTMLElement}
 */
function createToolBlock(tool) {
  const block = document.createElement('div');
  block.className = 'message-tool';

  const row = document.createElement('div');
  row.className = 'message-tool-row';

  const icon = document.createElement('span');
  icon.className = 'message-tool-icon';
  icon.append(createGlyph('file', 14));
  row.append(icon);

  const name = document.createElement('span');
  name.className = 'message-tool-name';
  name.textContent = String(tool?.name ?? '');
  row.append(name);

  if (tool?.state) {
    const badge = document.createElement('span');
    badge.className = 'message-tool-badge';
    badge.textContent = String(tool.state);
    row.append(badge);
  }

  block.append(row);

  if (tool?.detail) {
    const diff = document.createElement('p');
    diff.className = 'message-tool-diff';
    diff.textContent = String(tool.detail);
    block.append(diff);
  }

  return block;
}

/**
 * The still-arriving row at the end of a reply: the design's 2 x 16 caret, three
 * 4 px dots on their 8 px pitch and the label. The row's dots are its own, not
 * the Loading Dots block, so the block keeps its one job.
 * @returns {HTMLElement}
 */
function createStreamingRow() {
  const row = document.createElement('div');
  row.className = 'message-streaming';

  const caret = document.createElement('span');
  caret.className = 'message-streaming-caret';
  caret.setAttribute('aria-hidden', 'true');

  const dots = document.createElement('span');
  dots.className = 'message-streaming-dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'message-streaming-dot';
    dots.append(dot);
  }

  const label = document.createElement('span');
  label.className = 'message-streaming-label';
  label.textContent = 'streaming...';

  row.append(caret, dots, label);
  return row;
}

/**
 * A reply that failed: the reason in a card and the way out under it.
 * @param {any} message
 * @returns {{ card: HTMLElement, retry: HTMLElement }}
 */
function createFailureParts(message) {
  const card = document.createElement('div');
  card.className = 'message-error-card';

  const title = document.createElement('p');
  title.className = 'message-error-title';
  title.textContent = "The model couldn't finish this reply.";
  card.append(title);

  const detail = document.createElement('p');
  // The bubble's own text element keeps the reason where a reader (and the smoke
  // check that reads it) expects the turn's words; the card rules restyle it as
  // the node's mono detail line.
  detail.className = 'message-text message-error-detail';
  detail.textContent = String(message.content ?? '');
  card.append(detail);

  const row = document.createElement('div');
  row.className = 'message-retry-row';

  const retry = document.createElement('button');
  retry.className = 'message-retry';
  retry.type = 'button';
  retry.append(createGlyph('retry', 14));
  const retryLabel = document.createElement('span');
  retryLabel.textContent = 'Try again';
  retry.append(retryLabel);
  row.append(retry);

  const hint = document.createElement('p');
  hint.className = 'message-retry-hint';
  hint.textContent = 'or fix the key in Settings';
  row.append(hint);

  return { card, retry: row };
}

/**
 * Build one turn in the transcript, shaped by design node 0:1221.
 *
 * A stored message only carries role, content and time, so the extra parts the
 * node draws ride on optional fields: `mode` for the badge, `attachments` for the
 * chips under the reader's bubble, `tool` for the file-change card, and `state`
 * for the reply that is still arriving or has failed.
 * @param {{ id?: string, role?: string, content?: string, createdAt?: string, mode?: string, state?: string, attachments?: Array<any>, tool?: any }} message
 * @param {{ initials?: string }} [options]
 * @returns {HTMLElement}
 */
/**
 * A message's text as the node draws it: one block per paragraph. The node gives a
 * reply's second paragraph its own 8 px slot on the stack (node 0:1221), which a
 * single block with blank lines inside it cannot do, so a blank line starts a block.
 * @param {string} content
 * @returns {HTMLParagraphElement[]}
 */
export function createMessageText(content) {
  return String(content ?? '')
    .split(/\n{2,}/u)
    .map((paragraph) => {
      const text = document.createElement('p');
      text.className = 'message-text';
      text.textContent = paragraph;
      return text;
    });
}

/**
 * Replace whatever text blocks a bubble is showing, so the saved message is what the
 * reader ends up with even when it arrived one token at a time.
 * @param {HTMLElement} bubble
 * @param {string} content
 * @returns {void}
 */
function setMessageText(bubble, content) {
  const stack = bubble.querySelector('.message-stack');
  if (!stack) return;
  const blocks = createMessageText(content);
  const first = stack.querySelector('.message-text');
  if (first) {
    first.replaceWith(...blocks);
    return;
  }
  const streaming = stack.querySelector('.message-streaming');
  if (streaming) streaming.before(...blocks);
  else stack.append(...blocks);
}

export function createMessageElement(message, options = {}) {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const failed = message.state === 'failed';
  const article = document.createElement('article');
  article.className = 'message';
  article.dataset.role = role;
  article.dataset.mode = modeFor(message);
  article.dataset.messageId = String(message.id ?? '');
  if (failed) article.dataset.state = 'failed';

  const stack = document.createElement('div');
  stack.className = 'message-stack';

  const meta = createMetaRow(role, message, options.initials);
  const time = document.createElement('time');
  time.className = 'message-time';
  if (message.createdAt) time.dateTime = message.createdAt;
  time.textContent = formatClock(message.createdAt);
  meta.append(time);
  stack.append(meta);

  if (failed) {
    const { card, retry } = createFailureParts(message);
    stack.append(card, retry);
  } else {
    stack.append(...createMessageText(message.content));

    if (role === 'user' && Array.isArray(message.attachments) && message.attachments.length > 0) {
      stack.append(createAttachmentList(message.attachments));
    }

    if (role === 'assistant' && message.tool) {
      stack.append(createToolBlock(message.tool));
    }

    if (role === 'assistant' && message.state === 'streaming') {
      stack.append(createStreamingRow());
    }
  }

  if (role === 'assistant') {
    article.append(createAssistantAvatar(failed), stack);
  } else {
    article.append(stack);
  }

  return article;
}

/**
 * Build the design's Loading Dots block: three 6 px round dots on a 12 px pitch,
 * centred on the reply's 20 px line and drawn in color/text-subtle. It holds the
 * reply's place until the first token lands, so a slow provider still looks like
 * an answer on its way.
 * @returns {HTMLElement}
 */
export function createLoadingDots() {
  const block = document.createElement('span');
  block.className = 'loading-dots';
  // The dots are shapes, not text: the label is the only thing a screen reader has.
  block.setAttribute('role', 'img');
  block.setAttribute('aria-label', 'Waiting for a reply');

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'loading-dots-dot';
    dot.setAttribute('aria-hidden', 'true');
    block.append(dot);
  }

  return block;
}

/**
 * Build the bubble that stands in for a reply that never arrived.
 * It is an assistant turn in the transcript, styled as failed, and announced to a
 * screen reader: an error the user cannot see is the same as a dropped message.
 * @param {string} message
 * @returns {HTMLElement}
 */
export function createErrorBubble(message) {
  const article = createMessageElement({ role: 'assistant', content: message, state: 'failed' });
  article.setAttribute('role', 'status');
  article.setAttribute('aria-live', 'polite');
  return article;
}

/**
 * Grow the draft by whole lines, up to MAX_INPUT_LINES, then scroll it.
 *
 * A textarea cannot be sized by CSS alone: `rows="1"` fixes it and a fixed height
 * clips a long prompt. scrollHeight is the content height, so the height is reset to
 * 'auto' first (otherwise the current height is the floor) and then clamped to the
 * cap; past the cap the box scrolls instead of hiding text under the pill edge.
 * @param {HTMLTextAreaElement | null | undefined} input
 * @returns {void}
 */
export function fitComposerInput(input) {
  if (!input) return;

  const style = getComputedStyle(input);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  const oneLine = Math.round(lineHeight + padding);
  const cap = Math.round(lineHeight * MAX_INPUT_LINES + padding);

  // 'auto' first: scrollHeight can never report less than the box already is.
  input.style.height = 'auto';
  // An empty draft is one line, except where the placeholder itself wraps: a phone
  // needs two or three lines to show the whole invitation, and a clipped one is worse
  // than a pill a line taller. The cap keeps an empty box from standing very tall.
  const wanted =
    input.value === ''
      ? Math.min(Math.max(input.scrollHeight, oneLine), oneLine * 3)
      : Math.max(input.scrollHeight, oneLine);
  const height = Math.min(wanted, cap);
  input.style.height = `${height}px`;
  // Only a draft longer than the cap scrolls; otherwise the scrollbar would show as
  // a stray grey bar beside a one-line prompt.
  input.style.overflowY = wanted > cap ? 'auto' : 'hidden';
  input.dataset.lines = String(Math.max(1, Math.round((height - padding) / lineHeight)));
}

/** Controls already mounted per pill, so a second call never adds a second set. */
const MOUNTED = new WeakMap();

/**
 * The pill's round glyph buttons: the attachment button and the send button.
 * @param {string} className
 * @param {string} id
 * @param {string} label
 * @param {'attach' | 'send'} glyph
 * @returns {HTMLButtonElement}
 */
function createIconButton(className, id, label, glyph) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.id = id;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(createGlyph(glyph, 16));
  return button;
}

/**
 * The draft: one row tall to start with, grown by fitComposerInput.
 * @returns {HTMLTextAreaElement}
 */
function createDraft() {
  const input = document.createElement('textarea');
  input.className = 'composer-input';
  input.id = 'composer-input';
  input.rows = 1;
  input.placeholder = 'Ask Zuri anything, or describe a task for it to do…';
  input.setAttribute('aria-label', 'Message Zuri');
  return input;
}

/**
 * The model selector: a chip-shaped native select, so the choice is reachable by
 * keyboard and screen reader without a popup to trap and dismiss.
 * @param {string} model
 * @returns {{ element: HTMLElement, select: HTMLSelectElement, setModel: (name: string) => void }}
 */
function createModelSelector(model) {
  const wrap = document.createElement('div');
  wrap.className = 'composer-model';

  const select = document.createElement('select');
  select.className = 'composer-model-select';
  select.id = 'composer-model';
  select.setAttribute('aria-label', 'Model');
  select.title = 'Model for the next message';
  wrap.append(select);

  // The chip is the drawn control from ui/select.js: a native select's list is painted
  // by Windows and cannot wear the design. The select stays the value the change
  // handler below reads, so the saved model still leaves as the same event.
  enhanceSelect(select, { doc: select.ownerDocument });

  /** @param {string} name */
  function setModel(name) {
    const label = typeof name === 'string' ? name.trim() : '';
    if (label === '') return;
    // A model saved for a provider the list does not name still has to be shown, or
    // the selector would claim a model the next send is not using.
    if (!Array.from(select.options).some((option) => option.value === label)) {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.append(option);
    }
    select.value = label;
  }

  for (const name of MODEL_OPTIONS) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  setModel(model);

  // The choice belongs in settings, which only the page can write; it leaves as an
  // event so the composer keeps working when it is mounted on its own.
  select.addEventListener('change', () => {
    wrap.dispatchEvent(
      new CustomEvent('composer-model', { bubbles: true, detail: { value: select.value } }),
    );
  });

  return { element: wrap, select, setModel };
}

/**
 * The Ask / Act / Autopilot selector: three pressed-state buttons on the pill. The
 * pressed one is the mode every send carries.
 * @param {string} mode
 * @returns {{ element: HTMLElement, buttons: Map<string, HTMLButtonElement>, sync: (next: string) => void }}
 */
function createModeSelector(mode) {
  const group = document.createElement('div');
  group.className = 'composer-modes';
  group.id = 'composer-modes';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Mode');

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  for (const item of MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'composer-mode';
    button.dataset.mode = item.id;
    button.title = item.hint;
    button.textContent = item.label;
    buttons.set(item.id, button);
    group.append(button);
  }

  /** @param {string} next */
  function sync(next) {
    for (const [id, button] of buttons) {
      button.setAttribute('aria-pressed', String(id === next));
    }
  }
  sync(mode);

  return { element: group, buttons, sync };
}

/**
 * Render the composer's controls into the pill: the attachment button, the draft, the
 * model selector, the Ask / Act / Autopilot selector and the send button, and wire the
 * draft's auto-grow.
 *
 * The page ships the three plain controls, so the pill paints before any module runs;
 * this adds the two that carry state and fills in anything a bare pill is missing. Safe
 * to call twice: the second call returns what is mounted.
 * @param {Record<string, HTMLElement>} elements The chat column's nodes.
 * @returns {{ pill: HTMLElement, model: ReturnType<typeof createModelSelector>, modes: ReturnType<typeof createModeSelector> } | null}
 */
export function renderComposerControls(elements) {
  const shell = elements?.composer;
  if (!shell) return null;

  // Only a shell that carries the pill gets the selectors: the pill is what clips them
  // to one row. A bare root (a test stand-in, or a page without the pill) is left
  // alone rather than grown by two controls it cannot lay out.
  const pill = shell.classList?.contains('composer') ? shell : shell.querySelector('.composer');
  if (!pill) return null;

  const existing = MOUNTED.get(pill);
  if (existing) return existing;

  const mode = Object.hasOwn(MODE_LABELS, pill.dataset.mode) ? pill.dataset.mode : MODES[0].id;
  pill.dataset.mode = mode;

  // The page ships the attachment button, the draft and the send button so the pill
  // paints before any module runs; a bare pill gets them here. Either way this is the
  // module that renders the composer: five controls and the draft that carries them.
  let attach = pill.querySelector('.composer-button');
  if (!attach) {
    attach = createIconButton('composer-button', 'composer-attach', 'Attach a file', 'attach');
    pill.append(attach);
  }
  let input = elements.input ?? pill.querySelector('.composer-input');
  if (!input) {
    input = createDraft();
    attach.after(input);
  }
  let send = elements.send ?? pill.querySelector('.composer-send');
  if (!send) {
    send = createIconButton('composer-send', 'composer-send', 'Send', 'send');
    pill.append(send);
  }
  elements.attach = attach;
  elements.input = input;
  elements.send = send;

  const model = createModelSelector(DEFAULT_MODEL);
  const modes = createModeSelector(mode);

  for (const [id, button] of modes.buttons) {
    button.addEventListener('click', () => {
      pill.dataset.mode = id;
      modes.sync(id);
      // The pressed button moved under the pointer, so the caret goes back to the
      // draft: the choice was about the next message, not this button.
      elements.input?.focus();
    });
  }

  send.before(model.element, modes.element);

  // The draft grows on every edit, whoever else is listening for input.
  if (input.dataset.autogrow !== 'true') {
    input.dataset.autogrow = 'true';
    input.addEventListener('input', () => fitComposerInput(input));
    fitComposerInput(input);
  }

  const controls = { pill, model, modes };
  MOUNTED.set(pill, controls);
  return controls;
}

/**
 * Show a model the page read from settings in the pill's selector.
 * @param {Record<string, HTMLElement>} elements
 * @param {string} name
 * @returns {void}
 */
export function setComposerModel(elements, name) {
  renderComposerControls(elements)?.model.setModel(name);
}

/**
 * The mode the selector is showing, which is what every send carries.
 * @param {Record<string, HTMLElement>} elements
 * @returns {string}
 */
export function composerMode(elements) {
  const pill = elements?.composer?.querySelector('.composer');
  const mode = pill?.dataset.mode ?? '';
  return Object.hasOwn(MODE_LABELS, mode) ? mode : MODES[0].id;
}

/**
 * Wire the composer over the markup in index.html.
 *
 * @param {object} options
 * @param {Record<string, HTMLElement>} options.elements The chat column's nodes.
 * @param {Record<string, Function>} options.chats The `window.zuri.chats` namespace.
 * @param {Record<string, Function>} [options.chat] The `window.zuri.chat` namespace.
 * @param {() => Promise<any | null>} options.ensureThread Thread to append to, created if needed.
 * @param {() => any | null} options.currentThread Thread on screen, for Retry.
 * @param {(thread: any) => void} options.applyThread Take the store's copy of a thread.
 * @param {(message: string) => void} options.report Put a line under the composer.
 * @param {() => void} options.clearReport Restore the composer's default hint.
 * @param {() => void} [options.refreshMeta] Repaint the header's message count.
 * @param {() => boolean} [options.lastReplyFailed] Whether the newest turn failed.
 * @returns {{ send: () => Promise<void>, retry: () => Promise<void>, sync: () => void, stop: () => Promise<void> }}
 */
export function createComposer({
  elements,
  chats,
  chat,
  ensureThread,
  currentThread,
  applyThread,
  report,
  clearReport,
  refreshMeta = () => {},
  lastReplyFailed = () => false,
}) {
  let sending = false;

  // The model and mode selectors belong to the pill: mounting here means createComposer
  // works on the page's markup and on a bare pill alike, and never adds a second set.
  renderComposerControls(elements);

  /** The thread whose reply is in flight, so Stop addresses the right request. */
  let streamingThreadId = null;

  /** Send is live only with text to send and nothing in flight. */
  function sync() {
    const canSend = !sending && elements.input.value.trim() !== '';
    elements.send.disabled = !canSend;
    elements.send.setAttribute('aria-disabled', String(!canSend));
    // The design's disabled state (node 0:823): while a reply is in flight the input
    // is inert too, so a second message cannot be queued into a busy composer and
    // then arrive out of order.
    elements.input.disabled = sending;
    elements.input.setAttribute('aria-disabled', String(sending));
    elements.composer.dataset.state = sending ? 'disabled' : 'ready';
    // The clamp is re-run on every state change too: emptying the draft after a send
    // has to bring the pill back down to one line.
    fitComposerInput(elements.input);
    // The line follows the state: waiting, retryable, or a plain invitation.
    elements.input.placeholder = sending
      ? PLACEHOLDER.working
      : lastReplyFailed()
        ? PLACEHOLDER.retry
        : PLACEHOLDER.prompt;
  }

  /**
   * Show the design's streaming row (node 0:944): the loader, what Zuri is doing,
   * and Stop. Appended last so it reads as the end of the conversation.
   * @param {string} threadId
   * @param {string} [label]
   */
  function showStreaming(threadId, label = STREAMING_LABEL) {
    streamingThreadId = threadId;
    elements.streamLabel.textContent = label;
    // A new reply starts with Stop pressable, whatever the last one left behind.
    elements.streamStop.disabled = false;
    elements.stream.hidden = false;
    elements.transcript.append(elements.stream);
  }

  /** @returns {void} */
  function hideStreaming() {
    streamingThreadId = null;
    elements.stream.hidden = true;
    elements.streamStop.disabled = false;
  }

  /**
   * Stop the reply that is arriving.
   *
   * Main aborts the request, so nothing is appended to chats.json: the transcript
   * drops the half-written bubble rather than leaving text on screen that no stored
   * message backs. The thread stays as it was, with the person's message in it.
   * @returns {Promise<void>}
   */
  async function stop() {
    const threadId = streamingThreadId;
    if (threadId === null) return;
    // One press is enough; the row leaves when the aborted send settles.
    elements.streamStop.disabled = true;
    if (typeof chat?.stop !== 'function') return;
    await call(() => chat.stop({ threadId }));
  }

  /** Keep the newest message in view as the reply grows. */
  function scrollToEnd() {
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  }

  /**
   * Put a bubble at the end of the transcript and drop the empty hero.
   * @param {HTMLElement} bubble
   */
  function appendBubble(bubble) {
    elements.transcript.append(bubble);
    elements.hero.hidden = true;
    elements.transcript.dataset.state = 'filled';
    refreshMeta();
    scrollToEnd();
  }

  /**
   * Call one bridge method and turn a rejected call into the same failed-result
   * shape main uses, so one branch handles both.
   * @param {() => Promise<any>} thunk
   * @returns {Promise<{ ok: boolean, data?: any, error?: { code?: string, message?: string } }>}
   */
  async function call(thunk) {
    try {
      return await thunk();
    } catch (error) {
      return { ok: false, error: { message: String(error?.message ?? error) } };
    }
  }

  /**
   * Stream one reply into a bubble and settle it from the saved message.
   * @param {string} threadId
   * @param {string} [mode] The mode this request was made in; main only answers in Ask.
   * @returns {Promise<void>}
   */
  async function requestReply(threadId, mode = composerMode(elements)) {
    if (typeof chat?.send !== 'function' || typeof chat?.onStream !== 'function') {
      appendBubble(createErrorBubble(NO_REPLY_PATH));
      return;
    }

    const bubble = createMessageElement({ role: 'assistant', content: '', createdAt: new Date().toISOString() });
    bubble.dataset.state = 'streaming';

    // While the first token is awaited the Loading Dots block stands in the text
    // slot, as the design draws a waiting reply. With the first token it gives way
    // to the reply, and the design's streaming row takes over underneath.
    const dots = createLoadingDots();
    bubble.querySelector('.message-text').append(dots);
    appendBubble(bubble);
    showStreaming(threadId);

    const text = bubble.querySelector('.message-text');
    const time = bubble.querySelector('.message-time');

    // Tokens are addressed to a thread, so a second window's stream cannot paint
    // into this bubble.
    const unsubscribe = chat.onStream((event) => {
      if (event?.threadId !== threadId || typeof event.delta !== 'string') return;
      // The first token turns the placeholder into the reply itself; after that the
      // streaming row carries the live state, as the node draws it.
      dots.remove();
      const stack = bubble.querySelector('.message-stack');
      if (stack && !stack.querySelector('.message-streaming')) stack.append(createStreamingRow());
      text.textContent += event.delta;
      scrollToEnd();
    });

    let result;
    try {
      result = await call(() => chat.send({ threadId, mode }));
    } finally {
      // Detach before anything else can throw, or a failed send leaves a listener
      // behind that outlives the bubble.
      unsubscribe();
      hideStreaming();
    }

    if (!result?.ok) {
      bubble.remove();

      // A reply the person stopped is not a failure: say what it means instead of
      // offering Retry for something that was deliberately ended.
      if (result?.error?.code === 'CHAT_STOPPED') {
        report('Stopped. That reply was not saved.');
        return;
      }

      appendBubble(createErrorBubble(result?.error?.message ?? 'No reply came back. Try again.'));
      return;
    }

    // The saved message is the truth: a window that missed a token still ends up
    // showing exactly what was written to chats.json.
    const message = result.data?.message;
    // A reply that never streamed still settles: the placeholder must not outlive it.
    dots.remove();
    bubble.querySelector('.message-streaming')?.remove();
    if (typeof message?.content === 'string') setMessageText(bubble, message.content);
    bubble.dataset.messageId = String(message?.id ?? '');
    bubble.dataset.state = 'sent';
    refreshMeta();

    if (message?.createdAt) {
      time.dateTime = message.createdAt;
      time.textContent = formatClock(message.createdAt);
    }

    if (result.data?.thread) applyThread(result.data.thread);
    scrollToEnd();
  }

  /**
   * Save the composer's text, then ask for a reply.
   *
   * The user bubble appears before the write resolves, so a slow disk never looks
   * like a dropped message; a failed write marks it instead of removing it, and the
   * reply is skipped because there would be nothing to reply to.
   * @returns {Promise<void>}
   */
  async function send() {
    const content = elements.input.value.trim();
    if (content === '' || sending) return;

    // Read once, before anything is awaited: the selector must not change under a
    // message that was already being sent, or the badge would lie about the turn.
    const sentMode = composerMode(elements);

    const thread = await ensureThread();
    if (!thread) return;

    elements.input.value = '';
    sending = true;
    sync();

    try {
      const bubble = createMessageElement({
        role: 'user',
        content,
        mode: sentMode,
        createdAt: new Date().toISOString(),
      });
      bubble.dataset.state = 'pending';
      appendBubble(bubble);

      // The mode rides on the stored message as well as the request, so a reopened
      // chat still shows which mode a turn was made in.
      const saved = await call(() =>
        chats.appendMessage({ threadId: thread.id, message: { role: 'user', content, mode: sentMode } }),
      );

      if (!saved?.ok) {
        const reason = saved?.error?.message ?? 'This message was not saved.';
        bubble.dataset.state = 'failed';
        const note = document.createElement('p');
        note.className = 'message-error';
        note.textContent = reason;
        bubble.append(note);
        report(reason);
        return;
      }

      bubble.dataset.messageId = String(saved.data.message.id);
      bubble.dataset.state = 'sent';
      applyThread(saved.data.thread);
      clearReport();

      await requestReply(thread.id, sentMode);
    } finally {
      sending = false;
      sync();
      elements.input.focus();
    }
  }

  /**
   * Ask again for the reply to the thread on screen.
   *
   * Retry is what the error block offers, and it only means something when the
   * last turn is the user's: no reply arrived, so the request is the thing to
   * repeat. With nothing unanswered it says so under the composer, rather than
   * asking for a reply to a conversation that has no question in it.
   * @returns {Promise<void>}
   */
  async function retry() {
    if (sending) return;

    const thread = currentThread();
    const last = thread?.messages?.[thread.messages.length - 1];
    if (!thread || last?.role !== 'user') {
      report('There is nothing to retry yet.');
      return;
    }

    sending = true;
    sync();
    try {
      clearReport();
      await requestReply(thread.id, composerMode(elements));
    } finally {
      sending = false;
      sync();
      elements.input.focus();
    }
  }

  /**
   * Hold the drawn "reply in flight" state, or leave it.
   *
   * The screen review opens the page with ?state=disabled to see the state the design
   * calls the disabled composer; a real reply does the same thing when one arrives.
   * @param {boolean} next
   * @returns {void}
   */
  function setSending(next) {
    sending = Boolean(next);
    sync();
  }

  return { send, retry, sync, stop, setSending };
}
