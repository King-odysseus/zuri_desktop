/**
 * dom.js - the building blocks the routed views are written with.
 *
 * The views under src/renderer/views build their content in JS because it depends
 * on state (a file list, the stored theme). These four helpers keep such a build to
 * one line per element instead of five, and give every non-chat route the same
 * frame - title, lead, cards - so they cannot drift into four different layouts.
 * No template engine: decision 1 rules that out.
 */

/**
 * One element with its class and, when it has any, one text child.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

/**
 * A container with children appended in order. Missing children are skipped so a
 * caller can pass the result of an optional branch without inline conditionals.
 * @param {string} tag
 * @param {string} className
 * @param {Array<HTMLElement | null | undefined>} children
 * @returns {HTMLElement}
 */
export function container(tag, className, children) {
  const node = element(tag, className);
  node.append(...children.filter(Boolean));
  return node;
}

/**
 * A card: a titled block with its copy above whatever rows or controls it holds.
 * @param {{ title?: string, text?: string, children?: Array<HTMLElement | null | undefined> }} options
 * @returns {HTMLElement}
 */
export function card({ title = '', text = '', children = [] }) {
  return container('div', 'view-card', [
    title === '' ? null : element('h2', 'view-card-title', title),
    text === '' ? null : element('p', 'view-card-text', text),
    ...children,
  ]);
}

/**
 * One line of a card: what it is on the left, its control or value on the right.
 * @param {{ label: string, note?: string, value?: string, control?: HTMLElement | null }} options
 * @returns {HTMLElement}
 */
export function row({ label, note = '', value = '', control = null }) {
  const copy = container('div', 'view-row-copy', [
    element('p', 'view-row-label', label),
    note === '' ? null : element('p', 'view-row-note', note),
  ]);
  const trailing = control ?? (value === '' ? null : element('span', 'view-row-value', value));
  return container('div', 'view-row', [copy, trailing]);
}

/**
 * A routed page: the title and its lead, any actions beside them, then the cards.
 * @param {{ title: string, lead: string, actions?: HTMLElement[], sections?: HTMLElement[] }} options
 * @returns {HTMLElement}
 */
export function pageView({ title, lead, actions = [], sections = [] }) {
  const head = container('header', 'view-page-head', [
    container('div', 'view-page-copy', [
      element('h1', 'view-page-title', title),
      element('p', 'view-page-lead', lead),
    ]),
    actions.length === 0 ? null : container('div', 'view-page-actions', actions),
  ]);

  const page = element('section', 'view-page');
  page.append(container('div', 'view-page-inner', [head, ...sections]));
  return page;
}

/**
 * An outlined page action: the same 32 px button the shell uses for secondary
 * actions, so a view never invents a third button shape.
 * @param {string} label
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
export function button(label, onClick) {
  const control = element('button', 'view-button', label);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}
