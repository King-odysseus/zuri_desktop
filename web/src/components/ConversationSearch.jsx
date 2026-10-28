import { Search, X } from 'lucide-react';

/** Search control for the saved conversation list. */
export default function ConversationSearch({ value = '', onChange, onClear }) {
  const hasQuery = value.trim() !== '';

  return (
    <label className="conversation-search">
      <Search size={16} aria-hidden="true" />
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
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}
