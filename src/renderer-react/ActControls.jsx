import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import { ApprovalIcon, CheckIcon, ChevronDownIcon } from './Icons.jsx';

// The three ways a message can be sent. The keys match CHAT_MODES in
// src/main/providers/chat.js, which treats anything else as Ask.
export const CHAT_MODE_CHOICES = [
  { key: 'ask', label: 'Ask', note: 'Answers and reads. Changes nothing on your computer.' },
  { key: 'act', label: 'Act', note: 'Can edit a copy, save a file or open something. Asks you first, every time.' },
  { key: 'autopilot', label: 'Autopilot', note: 'Does the safe steps on its own. Still asks before replacing a file.' },
];

const MODE_STORAGE_KEY = 'zuri.chatMode';

/** The mode last used on this computer; Ask when nothing was saved or storage is blocked. */
export function readChatMode() {
  try {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
    return CHAT_MODE_CHOICES.some((choice) => choice.key === saved) ? saved : 'ask';
  } catch {
    // Private windows and blocked storage throw; Ask is the safe answer then.
    return 'ask';
  }
}

export function saveChatMode(mode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // The choice still applies to this chat; it just will not be remembered.
  }
}

/** The picker beside the model chip: Ask, Act or Autopilot. */
export function ModeMenu({ mode, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = CHAT_MODE_CHOICES.find((choice) => choice.key === mode) ?? CHAT_MODE_CHOICES[0];

  // Closes on the same two gestures as the model chip: a press elsewhere, or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    // Deliberately not positioned: the menu below anchors to the composer itself, so it
    // clears the whole field. Anchored to this chip it would sit over a growing draft.
    <div ref={ref} className="shrink-0">
      <Button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${current.label}`}
        title={`${current.label}. ${current.note}`}
        className="flex h-10 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted outline-none hover:text-foreground focus:ring-2 focus:ring-accent/30"
        onPress={() => setOpen((value) => !value)}
      >
        <span>{current.label}</span>
        <ChevronDownIcon size={12} />
      </Button>
      {open && (
        <div role="menu" aria-label="Mode" className="zuri-composer-menu zuri-mode-menu">
          {CHAT_MODE_CHOICES.map((choice) => (
            <Button
              key={choice.key}
              type="button"
              role="menuitemradio"
              aria-checked={choice.key === mode}
              className={`zuri-mode-option ${choice.key === mode ? 'is-active' : ''}`.trim()}
              onPress={() => {
                onChange(choice.key);
                setOpen(false);
              }}
            >
              <span className="zuri-mode-option-title">
                <span className="zuri-mode-option-name">{choice.label}</span>
                {choice.key === mode && <CheckIcon size={15} className="shrink-0" />}
              </span>
              <span className="zuri-mode-option-note">{choice.note}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A step Zuri wants to take and is waiting to be allowed. Nothing runs until the
 * person answers, and not answering counts as no (main closes the card itself).
 */
export function ApprovalCard({ approval, onAnswer }) {
  return (
    <div role="alert" className="mb-2 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-sm">
      <ApprovalIcon size={18} className="shrink-0 text-muted" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-medium">Zuri wants to:</span> {approval.summary}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" className="min-h-11 px-4" onPress={() => onAnswer(true)}>Allow</Button>
        <Button size="sm" variant="ghost" className="min-h-11 px-4" onPress={() => onAnswer(false)}>Not now</Button>
      </div>
    </div>
  );
}
