/**
 * select.js - the one dropdown in Zuri.
 *
 * Every dropdown in the app is a native <select>. That keeps the keyboard, the
 * form value and the `change` event each page already reads, but it hands the
 * open list to Windows: the popup is painted by the system, so in the dark shell
 * it arrives as a pale menu that no CSS can reach. That is the piece this module
 * takes back.
 *
 * The <select> stays in the document as the value holder - page code keeps
 * reading `select.value`, listening for `change` and toggling `disabled`, and
 * nothing in those pages has to change. What the person sees is a <button> that
 * wears the classes the page already gave its select, so each screen keeps the
 * field its own design node draws, and a list built from the design's Select /
 * Menu (node 0:43, `.select-menu` in styles/dropdown.css).
 *
 * Three things it deliberately follows instead of snapshotting:
 * - options rebuilt at runtime (onboarding swaps the model list per provider),
 * - `disabled` toggled while something saves,
 * - `select.value = ...` assigned by script (the audit Clear button does that,
 *   and assigning a value fires no event).
 *
 * Keyboard and screen readers get the standard combobox shape: the control is
 * one tab stop with role="combobox" and aria-expanded, the list is role="listbox"
 * with one role="option" per choice, and focus walks the options so Enter, the
 * arrows, Home, End, Escape and typing a letter all behave the way a native
 * select does.
 */

/** The control each <select> was given, so a second call is a no-op. */
const HANDLES = new WeakMap();

/** The menu that is open, so opening a second one closes the first. */
let closeOpenMenu = null;

/** How long typed letters keep building one search word, as a native select does. */
const TYPEAHEAD_MS = 600;

/** Gap between the control and its list, matching the design's 4 px rhythm. */
const MENU_GAP = 4;

/** Narrowest list worth opening, so a small control does not squash its options. */
const MENU_MIN_WIDTH = 120;

/**
 * The words a screen reader should hear for this control: its own <label>, then
 * its aria-label, then its title. Returned as text rather than as an id because
 * the labels in this app carry no ids of their own.
 * @param {HTMLSelectElement} select
 * @param {Document} doc
 * @returns {string}
 */
function labelTextFor(select, doc) {
  const label = labelElementFor(select, doc);
  const text = (label?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text !== '') return text;
  const fallback = (select.getAttribute('aria-label') ?? select.title ?? '').trim();
  return fallback === '' ? 'Options' : fallback;
}

/**
 * The <label for="..."> written for this control, if the page has one. Found by
 * walking the labels rather than by selector, so an id with a quote or a dot in it
 * cannot break the lookup.
 * @param {HTMLSelectElement} select
 * @param {Document} doc
 * @returns {HTMLLabelElement | null}
 */
function labelElementFor(select, doc) {
  if (select.id === '') return null;
  for (const element of doc.querySelectorAll('label')) {
    if (element.htmlFor === select.id) return element;
  }
  return null;
}

/**
 * Give one <select> a drawn control and a drawn list.
 *
 * Safe to call twice: the second call returns the control the first one built.
 * @param {HTMLSelectElement} select
 * @param {{ doc?: Document }} [options]
 * @returns {{ select: HTMLSelectElement, trigger: HTMLButtonElement, open: Function, close: Function, sync: Function, destroy: Function }}
 */
export function enhanceSelect(select, options = {}) {
  if (!select || select.tagName !== 'SELECT') {
    throw new TypeError('enhanceSelect expects a <select> element');
  }
  const already = HANDLES.get(select);
  if (already) return already;

  const doc = options.doc ?? select.ownerDocument;
  const win = doc.defaultView;
  const native = win.HTMLSelectElement.prototype;
  const label = labelElementFor(select, doc);
  const labelText = labelTextFor(select, doc);

  const trigger = doc.createElement('button');
  trigger.type = 'button';
  // The page's own select classes, so the closed control is the field that page's
  // design draws; `.select-trigger` only adds what a button does not inherit.
  trigger.className = `${select.className} select-trigger`.trim();
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', labelText);
  if (select.title !== '') trigger.title = select.title;

  // The native control keeps the value and the events; it gives up only its pixels.
  select.classList.add('select-native');
  select.before(trigger);

  /** @type {HTMLDivElement | null} */
  let menu = null;
  /** Index of the option holding focus while the list is open. */
  let activeIndex = -1;
  /** Letters typed so far, for the jump-to-a-word behaviour. */
  let typed = '';
  let typedAt = 0;

  /**
   * @returns {HTMLOptionElement | null}
   */
  function chosenOption() {
    const index = select.selectedIndex;
    return index >= 0 ? select.options[index] ?? null : null;
  }

  /**
   * @param {HTMLOptionElement | null} option
   * @returns {string}
   */
  function optionText(option) {
    return (option?.label ?? option?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Draw the control from the element it stands for. Called on load, after every
   * change, and whenever the page rebuilds the options.
   * @returns {void}
   */
  function sync() {
    const text = optionText(chosenOption());
    trigger.textContent = text;
    if (select.title === '') trigger.title = text;
    trigger.disabled = select.disabled;
    if (select.disabled) close();
  }

  /* A page that assigns `select.value` never fires an event, so the control would
     keep the word it had before (the audit Clear button resets three filters that
     way). Reads and writes still go to the native accessor; a write only has one
     extra step afterwards. */
  for (const property of ['value', 'selectedIndex']) {
    const descriptor = Object.getOwnPropertyDescriptor(native, property);
    if (typeof descriptor?.get !== 'function' || typeof descriptor?.set !== 'function') continue;
    Object.defineProperty(select, property, {
      configurable: true,
      get() {
        return descriptor.get.call(select);
      },
      set(next) {
        descriptor.set.call(select, next);
        sync();
      },
    });
  }

  /* Options and `disabled` change while the page runs - setup swaps the model list
     when the provider changes - so the control follows the element rather than the
     values read at load. */
  const observer = new win.MutationObserver(() => sync());
  observer.observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'label', 'title'],
  });

  /** @returns {string} */
  function menuId() {
    return `${select.id === '' ? 'dropdown' : `${select.id}-list`}-listbox`;
  }

  /**
   * Build one row per option. `aria-selected` is the whole state, so the fill and
   * the tick come from the one attribute the stylesheet reads.
   * @returns {void}
   */
  function renderRows() {
    if (menu === null) return;
    const rows = Array.from(select.options).map((option, index) => {
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'select-menu-option';
      row.id = `${menuId()}-option-${index}`;
      row.dataset.index = String(index);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === select.selectedIndex));
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      row.textContent = optionText(option);
      return row;
    });
    menu.replaceChildren(...rows);
  }

  /**
   * @param {number} index
   * @returns {HTMLElement | null}
   */
  function rowAt(index) {
    return menu?.children[index] ?? null;
  }

  /**
   * @param {number} index
   * @returns {boolean}
   */
  function rowIsDisabled(index) {
    return rowAt(index)?.getAttribute('aria-disabled') === 'true';
  }

  /**
   * Put focus on one row, stepping over the options the page disabled.
   * @param {number} index
   * @returns {void}
   */
  function focusRow(index) {
    const count = select.options.length;
    if (count === 0) return;
    let next = Math.min(Math.max(index, 0), count - 1);
    for (let tries = 0; tries < count && rowIsDisabled(next); tries += 1) next = (next + 1) % count;
    activeIndex = next;
    rowAt(next)?.focus();
  }

  /**
   * Walk the list by `delta`, wrapping at both ends the way a native list does.
   * @param {number} delta
   * @returns {void}
   */
  function moveRow(delta) {
    const count = select.options.length;
    if (count === 0) return;
    let next = activeIndex;
    for (let tries = 0; tries < count; tries += 1) {
      next = (next + delta + count) % count;
      if (!rowIsDisabled(next)) break;
    }
    activeIndex = next;
    rowAt(next)?.focus();
  }

  /**
   * Anchor the list to the control. Fixed to the viewport, so a scrolling panel
   * cannot clip it; opened upward when there is no room below.
   *
   * A list with no room below ends on the control's bottom edge rather than on its
   * top. That one decision does two things: the list is drawn over the control that
   * opened it, so the two read as one piece (a list floating a gap above the chip it
   * came from looks detached), and its bottom edge lines up with the control's, so
   * the panel does not stop short and leave a sliver of the chip showing under it.
   * The clamp keeps a list taller than the space above the control inside the window.
   * @returns {void}
   */
  function place() {
    if (menu === null) return;
    const rect = trigger.getBoundingClientRect();
    const room = win.innerWidth - MENU_GAP * 2;

    // Width: the control's own width, stretched to the widest option so a model
    // name is not cut to "claude-3-5-sonn" just because the chip that opened it is
    // 48 px wide. Measuring at max-content resolves the rows' own labels, and the
    // stylesheet's 260 px max-width caps a long one at the design's list width.
    menu.style.width = 'max-content';
    const natural = menu.offsetWidth;
    const width = Math.min(Math.max(Math.round(rect.width), natural, MENU_MIN_WIDTH), room);
    menu.style.width = `${width}px`;

    const height = menu.offsetHeight;
    const below = rect.bottom + MENU_GAP;
    const above = Math.max(MENU_GAP, rect.bottom - height);
    const fitsBelow = below + height <= win.innerHeight - MENU_GAP;
    const top = fitsBelow ? below : above;
    const left = Math.min(Math.round(rect.left), Math.max(MENU_GAP, win.innerWidth - width - MENU_GAP));

    menu.style.left = `${Math.max(MENU_GAP, left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  /**
   * Take one option. The value moves through the wrapped accessor, so the control's
   * word is right before the page hears anything, and the page then gets the same
   * `input` and `change` pair a native select sends.
   * @param {number} index
   * @returns {void}
   */
  function choose(index) {
    const option = select.options[index];
    if (!option || option.disabled) return;
    const changed = index !== select.selectedIndex;
    select.selectedIndex = index;
    close();
    trigger.focus();
    if (!changed) return;
    select.dispatchEvent(new win.Event('input', { bubbles: true }));
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  /**
   * Jump to the first row starting with what has been typed. Starts one past the
   * row in focus, so pressing the same letter again walks the matches.
   * @param {string} character
   * @returns {void}
   */
  function typeahead(character) {
    const now = win.Date.now();
    typed = now - typedAt > TYPEAHEAD_MS ? character : `${typed}${character}`;
    typedAt = now;
    const wanted = typed.toLowerCase();
    const count = select.options.length;
    const start = activeIndex >= 0 ? activeIndex : select.selectedIndex;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (start + offset + count) % count;
      const option = select.options[index];
      if (option.disabled) continue;
      if (optionText(option).toLowerCase().startsWith(wanted)) {
        focusRow(index);
        return;
      }
    }
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function onMenuKeydown(event) {
    const count = select.options.length;
    if (count === 0) {
      close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveRow(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveRow(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusRow(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusRow(count - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
      return;
    }
    if (event.key === 'Tab') {
      // Let focus move on, which is what a native list does.
      close();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typeahead(event.key);
    }
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function onMenuClick(event) {
    const target = event.target;
    const row = target instanceof win.Element ? target.closest('.select-menu-option') : null;
    if (!(row instanceof win.HTMLElement)) return;
    choose(Number(row.dataset.index));
  }

  /**
   * A press outside the list, or the control, closes it.
   * @param {PointerEvent} event
   * @returns {void}
   */
  function onOutside(event) {
    if (menu === null) return;
    const target = event.target;
    if (target instanceof win.Node && (menu.contains(target) || trigger.contains(target))) return;
    close();
  }

  /**
   * @returns {void}
   */
  function close() {
    if (menu === null) return;
    menu.removeEventListener('keydown', onMenuKeydown);
    menu.removeEventListener('click', onMenuClick);
    menu.remove();
    menu = null;
    activeIndex = -1;
    typed = '';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    doc.removeEventListener('pointerdown', onOutside, true);
    win.removeEventListener('resize', close);
    win.removeEventListener('scroll', close, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  }

  /**
   * @returns {void}
   */
  function open() {
    if (select.disabled || menu !== null) return;
    // One list on screen at a time: two open menus read as a bug.
    if (typeof closeOpenMenu === 'function') closeOpenMenu();

    menu = doc.createElement('div');
    menu.className = 'select-menu select-popup';
    menu.id = menuId();
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', labelText);
    renderRows();
    doc.body.append(menu);
    place();

    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', menu.id);
    menu.addEventListener('keydown', onMenuKeydown);
    menu.addEventListener('click', onMenuClick);
    doc.addEventListener('pointerdown', onOutside, true);
    win.addEventListener('resize', close);
    win.addEventListener('scroll', close, true);
    closeOpenMenu = close;

    focusRow(select.selectedIndex);
  }

  /** @returns {void} */
  function onTriggerClick() {
    if (menu !== null) close();
    else open();
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function onTriggerKeydown(event) {
    const opens =
      event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp';
    if (opens) {
      event.preventDefault();
      if (menu !== null) moveRow(event.key === 'ArrowUp' ? -1 : 1);
      else open();
      return;
    }
    if (event.key === 'Escape' && menu !== null) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') close();
  }

  /**
   * The <label for="..."> points at the hidden select, so a press on it would do
   * nothing; it focuses the control instead.
   * @param {MouseEvent} event
   * @returns {void}
   */
  function onLabelClick(event) {
    event.preventDefault();
    trigger.focus();
  }

  /**
   * Put the element back the way it was found.
   * @returns {void}
   */
  function destroy() {
    close();
    observer.disconnect();
    label?.removeEventListener('click', onLabelClick);
    trigger.removeEventListener('click', onTriggerClick);
    trigger.removeEventListener('keydown', onTriggerKeydown);
    trigger.remove();
    select.classList.remove('select-native');
    // Drop the wrapped accessors so the element is a plain <select> again.
    delete select.value;
    delete select.selectedIndex;
    HANDLES.delete(select);
  }

  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKeydown);
  label?.addEventListener('click', onLabelClick);
  sync();

  const handle = { select, trigger, open, close, sync, destroy };
  HANDLES.set(select, handle);
  return handle;
}

/**
 * Give every <select> under `root` a drawn control.
 * @param {ParentNode} [root] Defaults to the whole document.
 * @param {{ doc?: Document }} [options]
 * @returns {{ handles: Array<object>, destroy: () => void }}
 */
export function enhanceSelects(root = document, options = {}) {
  const doc = options.doc ?? (root.nodeType === 9 ? root : root.ownerDocument);
  const handles = [];
  for (const select of root.querySelectorAll('select:not(.select-native)')) {
    handles.push(enhanceSelect(select, { doc }));
  }
  return {
    handles,
    destroy: () => {
      for (const handle of handles) handle.destroy();
    },
  };
}
