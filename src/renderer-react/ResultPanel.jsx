import { useState } from 'react';
import { Button } from './ui.jsx';
import { CheckIcon, CloseIcon, CopyIcon } from './Icons.jsx';
import { copyText } from './clipboard.js';

/**
 * The side panel a result opens in: code from an answer, or the text of a file Zuri
 * made. It sits beside the chat so the conversation stays in view while the person
 * reads, and closing it leaves everything as it was.
 * @param {{ item: { title: string, subtitle?: string, text: string, loading?: boolean, error?: string, file?: { path: string } }, api: any, onClose: () => void }} props
 */
export default function ResultPanel({ item, api, onClose }) {
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');

  async function copy() {
    const done = await copyText(item.text);
    setCopied(done);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function fileAction(action) {
    if (typeof api?.files?.[action] !== 'function') return;
    const result = await api.files[action]({ path: item.file.path });
    setNote(result?.ok ? '' : result?.error?.message ?? 'That did not work.');
  }

  return (
    <aside
      aria-label="Result panel"
      className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-xl"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{item.title}</h2>
          {item.subtitle && <p className="truncate text-xs text-muted">{item.subtitle}</p>}
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="min-h-11 min-w-11"
          aria-label="Copy"
          title={copied ? 'Copied' : 'Copy'}
          isDisabled={item.loading || item.text === ''}
          onPress={() => void copy()}
        >
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        </Button>
        <Button isIconOnly size="sm" variant="ghost" className="min-h-11 min-w-11" aria-label="Close panel" title="Close panel" onPress={onClose}>
          <CloseIcon size={16} />
        </Button>
      </header>

      {item.file && (
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
          <Button size="sm" variant="secondary" className="min-h-11" onPress={() => void fileAction('open')}>Open</Button>
          <Button size="sm" variant="ghost" className="min-h-11" onPress={() => void fileAction('reveal')}>Show in folder</Button>
        </div>
      )}

      <div className="zuri-scrollbar-hidden min-h-0 flex-1 overflow-auto p-4">
        {item.loading && <p role="status" className="text-sm text-muted">Reading the file...</p>}
        {!item.loading && item.error && <p role="alert" className="text-sm text-danger">{item.error}</p>}
        {!item.loading && !item.error && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{item.text}</pre>
        )}
        {note !== '' && <p role="status" className="mt-3 text-xs text-muted">{note}</p>}
      </div>
    </aside>
  );
}
