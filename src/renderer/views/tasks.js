/**
 * Tasks view (route "tasks").
 *
 * Tasks are written by asking Zuri - the same rule the sidebar's reminders empty
 * block follows - so the one action on this page starts that request rather than
 * opening a form that cannot save anywhere. The request itself is handled by
 * ui/chats.js, which owns the composer; this view asks for it through an event so
 * the two modules stay independent (the router imports this view, so importing
 * the chat module here would be a cycle).
 */

import { button, card, pageView } from '../ui/dom.js';
import { TASK_REQUEST_EVENT } from '../ui/chats.js';

/**
 * @param {Document} [doc]
 * @param {{ navigate?: (name: string) => string }} [context] From ui/router.js.
 * @returns {HTMLElement}
 */
export function createView(doc = document, context = {}) {
  const start = button('Start a task request', () => {
    // The composer lives in the Chats view, so showing a request means showing it.
    context.navigate?.('chats');
    doc.dispatchEvent(new CustomEvent(TASK_REQUEST_EVENT));
  });

  return pageView({
    title: 'Tasks',
    lead: 'Everything Zuri is working on, with its status and when it is due.',
    actions: [start],
    sections: [
      card({
        title: 'No tasks yet',
        text: 'A task appears here once a chat request becomes one, with its status, the agent that ran it and its due time. Saving tasks needs the task store, which arrives with its own card.',
      }),
    ],
  });
}
