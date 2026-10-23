import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Input } from './ui.jsx';
import { SearchIcon } from './Icons.jsx';

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 100;

function formatDate(value) {
  if (typeof value !== 'string' || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function escapePattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wraps every case-insensitive hit so a long answer shows why it matched
// instead of making the reader scan the whole message.
function highlight(text, query) {
  if (query === '') return text;
  const pattern = new RegExp(`(${escapePattern(query)})`, 'ig');
  return String(text).split(pattern).map((part, index) => (
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={index} className="rounded bg-selected px-0.5 text-selected-foreground">{part}</mark>
      : part
  ));
}

function findMatch(thread, query) {
  const needle = query.toLowerCase();
  const title = String(thread?.title ?? '');
  const titleMatches = title.toLowerCase().includes(needle);
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  let matches = 0;
  let snippet = '';

  for (const message of messages) {
    const content = String(message?.content ?? '');
    const at = content.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    matches += 1;
    if (snippet !== '') continue;
    const start = Math.max(0, at - SNIPPET_BEFORE);
    const end = Math.min(content.length, at + needle.length + SNIPPET_AFTER);
    snippet = `${start > 0 ? '...' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '...' : ''}`;
  }

  return { titleMatches, matches, snippet };
}

export default function SearchView({ onSelectThread }) {
  const [threads, setThreads] = useState([]);
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (typeof window.zuri?.chats?.list !== 'function') {
        if (active) setStatus('unavailable');
        return;
      }
      const result = await window.zuri.chats.list();
      if (!active) return;
      if (result?.ok) {
        setThreads(Array.isArray(result.data) ? result.data : []);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (needle === '') return [];
    return threads
      .map((thread) => ({ thread, ...findMatch(thread, needle) }))
      .filter((entry) => entry.titleMatches || entry.matches > 0);
  }, [threads, needle]);

  function openFirstResult(event) {
    if (event.key !== 'Enter' || results.length === 0) return;
    event.preventDefault();
    onSelectThread?.(results[0].thread.id);
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header>
          <h1>Search</h1>
          <p>Find any word in your saved conversations, including the replies.</p>
        </header>

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="zuri-search-field">
            <span aria-hidden="true" className="zuri-search-icon"><SearchIcon size={18} /></span>
            <Input
              aria-label="Search conversations"
              placeholder="Search conversations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={openFirstResult}
              fullWidth
              autoFocus
            />
          </div>

          {status === 'unavailable' && (
            <p className="mt-4 text-sm text-muted">Search works inside the Zuri app, not in this preview.</p>
          )}
          {status === 'error' && (
            <p role="alert" className="mt-4 text-sm text-danger">Your conversations could not be read.</p>
          )}

          {status === 'ready' && needle === '' && (
            <div className="zuri-empty-state mt-4">
              <strong>Search every conversation</strong>
              <p>Type a word or person above. Matches show the reply they came from.</p>
            </div>
          )}

          {status === 'ready' && needle !== '' && results.length === 0 && (
            <div className="zuri-empty-state mt-4">
              <strong>No matches for "{query.trim()}"</strong>
              <p>Try a shorter word, or search the other way round.</p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <p className="mt-4 text-xs uppercase tracking-wide text-muted">
                {results.length} {results.length === 1 ? 'conversation' : 'conversations'}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {results.map(({ thread, titleMatches, matches, snippet }) => (
                  <li key={thread.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      fullWidth
                      className="h-auto items-start justify-start rounded-xl px-3 py-3 text-left"
                      onPress={() => onSelectThread?.(thread.id)}
                    >
                      <span className="flex min-w-0 w-full flex-col gap-1">
                        <span className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {highlight(thread.title || 'New chat', titleMatches ? needle : '')}
                          </span>
                          {matches > 0 && <Chip size="sm">{matches}</Chip>}
                          <span className="shrink-0 text-xs text-muted">{formatDate(thread.updatedAt)}</span>
                        </span>
                        {snippet !== '' && (
                          <span className="text-sm font-normal text-muted">{highlight(snippet, needle)}</span>
                        )}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
