import { CloseIcon, SearchIcon } from '../../../src/renderer-react/Icons.jsx';

/** Search control for the saved conversation list. */
export default function ConversationSearch({ value = '', onChange, onClear }) {
  const hasQuery = value.trim() !== '';

  return (
    <label className="conversation-search">
      <SearchIcon size={16} aria-hidden="true" />
      <span className="sr-only">Search conversations</span>
      <input
        type="search"
        value={value}
        placeholder="Search chats"
        aria-label="Search conversations"
        maxLength={120}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {hasQuery && (
        <button
          type="button"
          className="conversation-search-clear"
          aria-label="Clear conversation search"
          onClick={() => onClear?.()}
        >
          <CloseIcon size={14} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}
