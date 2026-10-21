/**
 * Chats view (route "chats") - the conversation the shell opens on.
 *
 * The transcript, its header and the composer ship in index.html rather than
 * being built here, for two reasons: ui/chats.js binds to those ids when it
 * starts, and decision 14 keeps view markup in HTML instead of JS template
 * strings. So this module's job is the router's, and only the router's: name the
 * element the central column shows for this route.
 */

/** The section index.html wraps the transcript in. */
const VIEW_ID = 'view-chats';

/**
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function createView(doc = document) {
  const view = doc.getElementById(VIEW_ID);
  if (!view) throw new Error(`the Chats view is missing #${VIEW_ID} from index.html`);
  return view;
}
