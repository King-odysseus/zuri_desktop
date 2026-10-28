const DRAFT_KEY = 'zuri-chat-draft';

/** Read the unsent composer text without breaking private browsing/WebViews. */
export function readChatDraft() {
  try {
    return window.localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Persist an unsent composer draft for the next app launch. */
export function saveChatDraft(value) {
  try {
    const text = String(value ?? '');
    if (text.trim() === '') {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // Storage can be disabled by the WebView or private browsing. Chat still works.
  }
}

/** Remove the draft after it has been sent or deliberately abandoned. */
export function clearChatDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage can be disabled by the WebView or private browsing. Chat still works.
  }
}
