/**
 * router.js - the central column shows one view at a time.
 *
 * The sidebar lists eight destinations (New chat, Chats, Agents, Tasks, Reminders,
 * Automations, Files and Settings). Each one names a route here, and a route owns
 * exactly one element inside #chat. The router builds that element once, keeps it,
 * and swaps which one is visible, so:
 *
 *   - every item opens a real, titled view and none can dead-end on a blank panel;
 *   - going back to a view keeps its state (the Files list does not re-read the
 *     folder, the settings choice stays where the user put it);
 *   - the Chat view is this file's markup in index.html, because ui/chats.js binds
 *     to those ids when it starts (decision 14 keeps view markup in HTML).
 *
 * No hash and no history: the window has one navigation surface and no back
 * button, so a URL segment would carry state that nothing else reads.
 */

import { PHONE_BREAKPOINT, setColumnCollapsed } from './shell.js';
import { createView as createChatsView } from '../views/chats.js';
import { createView as createAgentsView } from '../views/agents.js';
import { createView as createTasksView } from '../views/tasks.js';
import { createView as createRemindersView } from '../views/reminders.js';
import { createView as createAutomationsView } from '../views/automations.js';
import { createView as createFilesView } from '../views/files.js';
import { createView as createSettingsView } from '../views/settings.js';

/**
 * Every destination, in sidebar order, with the label its view and the sidebar row
 * both use. The first one is where the shell starts.
 */
export const ROUTES = Object.freeze([
  { name: 'chats', label: 'Chats', create: createChatsView },
  { name: 'agents', label: 'Agents', create: createAgentsView },
  { name: 'tasks', label: 'Tasks', create: createTasksView },
  { name: 'reminders', label: 'Reminders', create: createRemindersView },
  { name: 'automations', label: 'Automations', create: createAutomationsView },
  { name: 'files', label: 'Files', create: createFilesView },
  { name: 'settings', label: 'Settings', create: createSettingsView },
]);

export const DEFAULT_ROUTE = 'chats';

/**
 * @param {string} name
 * @returns {{ name: string, label: string, create: Function } | undefined}
 */
function routeNamed(name) {
  return ROUTES.find((route) => route.name === name);
}

/**
 * Wire the sidebar to the central column.
 * @param {{ doc?: Document, viewport?: Window }} [options]
 * @returns {{ navigate: (name: string) => string, current: () => string, view: (name: string) => HTMLElement }}
 */
export function initRouter({ doc = document, viewport = window } = {}) {
  const outlet = doc.getElementById('chat');
  const sidebar = doc.getElementById('sidebar');
  if (!outlet) throw new Error('the router has no outlet: #chat is missing');
  if (!sidebar) throw new Error('the router has no sidebar: #sidebar is missing');

  /** Created views, by route name. Built lazily, then kept for the session. */
  const mounted = new Map();

  /** @type {string} */
  let active = '';

  /**
   * The element for a route, created on first visit. A view that did not set its
   * own id and label gets them here, so the DOM names every route the same way.
   * @param {{ name: string, label: string, create: Function }} route
   * @returns {HTMLElement}
   */
  function viewFor(route) {
    const existing = mounted.get(route.name);
    if (existing) return existing;

    // The second argument is what a view may ask the shell for. Views never import
    // the router (it imports them), so navigation is handed in instead.
    const view = route.create(doc, { navigate });
    if (!view || typeof view !== 'object' || view.nodeType !== 1) {
      throw new Error(`the ${route.name} view did not return an element`);
    }

    view.classList.add('view');
    view.dataset.view = route.name;
    view.setAttribute('aria-label', route.label);
    if (!view.id) view.id = `view-${route.name}`;
    // Mounted hidden: navigate() decides what the user sees, not the factory.
    view.hidden = true;
    outlet.append(view);

    mounted.set(route.name, view);
    return view;
  }

  /**
   * Mark the sidebar row for this route current and clear the rest. aria-current is
   * both the announced state and the fill the stylesheet paints (see the nav row
   * component), so a row can never look current without being current.
   * @param {string} name
   */
  function markSidebar(name) {
    // The nav rows and the Settings row are the destinations; New chat also routes
    // but it is an action, and a page must not carry two "current" items.
    for (const control of sidebar.querySelectorAll('.nav-sidebar-row, .sidebar-settings-row')) {
      if (control.dataset.route === name) control.setAttribute('aria-current', 'page');
      else control.removeAttribute('aria-current');
    }
  }

  /**
   * Show one route. An unknown name falls back to Chats rather than leaving the
   * central column as it was: a typo must not look like a working click.
   * @param {string} name
   * @returns {string} the route that is now showing
   */
  function navigate(name) {
    const route = routeNamed(name) ?? routeNamed(DEFAULT_ROUTE);
    if (!route) throw new Error(`no route named ${DEFAULT_ROUTE}`);

    const next = viewFor(route);
    if (active !== '') {
      const previous = mounted.get(active);
      if (previous && previous !== next) previous.hidden = true;
    }

    next.hidden = false;
    outlet.dataset.view = route.name;
    outlet.setAttribute('aria-label', route.label);
    markSidebar(route.name);
    active = route.name;

    // On a phone the sidebar is a drawer over the conversation; picking a
    // destination closes it so the chosen view is what the user sees.
    if (viewport.innerWidth < PHONE_BREAKPOINT) setColumnCollapsed('sidebar', true);

    return active;
  }

  // One listener on the sidebar covers the nav rows, the Settings row and New
  // chat, all of which carry data-route. Nothing else in the shell owns their
  // click, so the route is the only thing a destination does.
  sidebar.addEventListener('click', (event) => {
    // The click lands on whichever child is under the pointer - a nav row's icon
    // path, its label or the row itself - so the search starts at the target and
    // walks up. Icons are SVG, which have closest() but are not HTMLElements.
    const target = event.target;
    const control = target && typeof target.closest === 'function' ? target.closest('[data-route]') : null;
    if (!control) return;
    navigate(control.dataset.route ?? DEFAULT_ROUTE);
  });

  navigate(DEFAULT_ROUTE);

  return {
    navigate,
    current: () => active,
    view: (name) => viewFor(routeNamed(name) ?? routeNamed(DEFAULT_ROUTE)),
  };
}
