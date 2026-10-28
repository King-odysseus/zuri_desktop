/**
 * Share text through the Android share sheet when the Web Share API is present.
 * Browsers and desktop builds fall back to copying, so the action remains useful
 * without a native plugin or a second platform-specific code path.
 * @param {{ title?: string, text: string }} input
 * @returns {Promise<'shared'|'copied'|'unavailable'>}
 */
export async function shareText({ title = 'Zuri', text }) {
  const value = typeof text === 'string' ? text : '';
  if (value.trim() === '') return 'unavailable';
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: value });
      return 'shared';
    } catch (error) {
      // Closing the Android sheet is not a failure. Do not overwrite the useful
      // copy fallback for browsers that reject the share request.
      if (error?.name === 'AbortError') return 'unavailable';
    }
  }
  return 'unavailable';
}
