/**
 * Agents view (route "agents").
 *
 * An agent is a saved brief - what it does, which tools it may use and when it
 * runs. Nothing stores agents yet (there is no `zuri:agents:*` channel and no
 * agents file in the store), so this view states that plainly instead of drawing
 * controls that would have nothing to save into. The page frame is the real one
 * every route uses, so the destination is a finished screen, not a stub panel.
 */

import { card, pageView } from '../ui/dom.js';

/**
 * @returns {HTMLElement}
 */
export function createView() {
  return pageView({
    title: 'Agents',
    lead: 'Saved briefs Zuri can run without you: what each one does, which tools it may use and when it runs.',
    sections: [
      card({
        title: 'No agents yet',
        text: 'Each agent will list its job, its tools and its last run here. Saving one needs the agents store, which arrives with its own card; until then the work happens in a chat.',
      }),
    ],
  });
}
