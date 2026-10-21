/**
 * The design's loading skeleton block (open-pencil "State / Skeleton Row",
 * node 0:296): a 320 x 159 card on 20 px padding, a 13 px "Loading list"
 * caption, then two rows of a 40 px disc beside two pills. Geometry and colours
 * live in components.css off the token layer, so the block follows the theme and
 * the node in one place; this module only builds its parts.
 */

/** The node's two rows, each with the width of its shorter pill. */
const ROW_NARROW_WIDTHS = [140, 120];

/**
 * Build the block. It stands in for a list that has not arrived yet, so it is
 * announced as one busy region rather than read out row by row.
 * @param {string} [label] What is loading, for assistive tech.
 * @returns {HTMLElement}
 */
export function createLoadingSkeleton(label = 'Loading') {
  const block = document.createElement('div');
  block.className = 'loading-skeleton';
  block.setAttribute('role', 'status');
  block.setAttribute('aria-label', label);

  // The node's own caption. It repeats what the label says, so it stays out of
  // the accessibility tree and the region is announced in one phrase.
  const caption = document.createElement('p');
  caption.className = 'loading-skeleton-caption';
  caption.setAttribute('aria-hidden', 'true');
  caption.textContent = 'Loading list';
  block.append(caption);

  for (const narrowWidth of ROW_NARROW_WIDTHS) {
    const row = document.createElement('div');
    row.className = 'loading-skeleton-row';
    // The narrower pill keeps its node width, so the stylesheet needs to know
    // which row it is drawing.
    row.dataset.narrow = String(narrowWidth);

    const disc = document.createElement('div');
    disc.className = 'loading-skeleton-disc';

    const lines = document.createElement('div');
    lines.className = 'loading-skeleton-lines';

    for (const pill of ['wide', 'narrow']) {
      const bar = document.createElement('span');
      bar.className = `loading-skeleton-bar loading-skeleton-bar--${pill}`;
      lines.append(bar);
    }

    // The shapes are not text: the label on the block is what a screen reader
    // gets, so each row stays out of the way.
    for (const part of [disc, lines]) part.setAttribute('aria-hidden', 'true');

    row.append(disc, lines);
    block.append(row);
  }

  return block;
}
