/**
 * The design's "Block / Loading Skeleton" (node 0:113): a 320 x 84 card holding
 * three 12 px bars at the node's 200 / 160 / 120 widths. Both the geometry and the
 * colours live in components.css off the token layer, so the block follows the
 * theme and matches the node in one place; this module only builds its parts.
 */

/**
 * Build the block. It stands in for content that has not arrived yet, so it is
 * announced as a busy region rather than read out bar by bar.
 * @param {string} [label] What is loading, for assistive tech only. The node has
 *   no text, so nothing is drawn for it.
 * @returns {HTMLElement}
 */
export function createLoadingSkeleton(label = 'Loading') {
  const block = document.createElement('div');
  block.className = 'loading-skeleton';
  block.setAttribute('role', 'status');
  block.setAttribute('aria-label', label);

  for (let index = 0; index < 3; index += 1) {
    const bar = document.createElement('div');
    bar.className = 'loading-skeleton-bar';
    // The bars are shapes, not text: the label on the block is what a screen
    // reader gets, so each bar stays out of the way.
    bar.setAttribute('aria-hidden', 'true');
    block.append(bar);
  }

  return block;
}
