import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from './ui.jsx';
import { CloseIcon, CopyIcon, DeleteIcon, DownloadIcon, RegenerateIcon } from './Icons.jsx';

// The key ChatPanel reads once on mount, so "Make another" lands in the composer with
// the words that drew the picture.
export const PENDING_IMAGE_PROMPT_KEY = 'zuri.pendingImagePrompt';

const PAGE_SIZE = 24;

function whenLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** One square tile. The picture is read only when the tile scrolls into view. */
function Tile({ item, api, onOpen }) {
  const [url, setUrl] = useState('');
  const holder = useRef(null);

  useEffect(() => {
    const node = holder.current;
    if (!node || typeof api?.images?.read !== 'function') return undefined;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void (async () => {
        const result = await api.images.read({ name: item.name });
        if (active && result?.ok) setUrl(result.data.url);
      })();
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [api, item.name]);

  return (
    <button
      ref={holder}
      type="button"
      onClick={() => onOpen(item, url)}
      className="group relative aspect-square w-full overflow-hidden rounded-xl bg-surface-secondary"
      aria-label={item.prompt !== '' ? `Open picture: ${item.prompt}` : 'Open picture'}
    >
      {url !== '' && <img src={url} alt={item.prompt} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" decoding="async" />}
    </button>
  );
}

/**
 * Every picture made on this computer. The files and their prompts are read from the
 * workspace images folder; nothing here talks to the cloud, so the library works offline.
 */
export default function ImageLibraryView({ onNavigate }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function reload() {
    if (typeof api?.images?.library !== 'function') {
      setStatus('error');
      return;
    }
    const result = await api.images.library();
    if (!result?.ok) {
      setStatus('error');
      setNote(result?.error?.message ?? 'The image library could not be read.');
      return;
    }
    setItems(result.data);
    setStatus('ready');
  }

  useEffect(() => { void reload(); }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter((item) => `${item.prompt} ${item.usedPrompt}`.toLowerCase().includes(needle));
  }, [items, query]);

  function close() {
    setOpen(null);
    setConfirmDelete(false);
    setNote('');
  }

  async function copyPicture() {
    try {
      const blob = await (await fetch(open.url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setNote('Picture copied.');
    } catch (error) {
      console.warn('[zuri:images] copy', error?.message ?? error);
      setNote('This computer would not let Zuri copy the picture. Use Save as instead.');
    }
  }

  async function savePicture() {
    const result = await api?.files?.saveAs?.({ path: open.item.path });
    if (!result?.ok) setNote(result?.error?.message ?? 'The picture could not be saved.');
    else if (result.data?.cancelled === false) setNote('Saved.');
  }

  async function deletePicture() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const result = await api?.images?.remove?.({ name: open.item.name });
    if (!result?.ok) {
      setNote(result?.error?.message ?? 'The picture could not be deleted.');
      return;
    }
    setItems((current) => current.filter((item) => item.name !== open.item.name));
    close();
  }

  function makeAnother() {
    try {
      window.sessionStorage.setItem(PENDING_IMAGE_PROMPT_KEY, open.item.prompt || open.item.usedPrompt);
    } catch (error) {
      console.warn('[zuri:images] pending prompt', error?.message ?? error);
    }
    close();
    onNavigate?.('chats');
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-medium tracking-tight">Images</h1>
              <p className="mt-1 text-sm text-muted">Everything Zuri has drawn for you. These pictures are kept on this computer only.</p>
            </div>
            <Input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setShown(PAGE_SIZE); }}
              placeholder="Search your pictures"
              aria-label="Search your pictures"
              className="w-full sm:w-64"
            />
          </header>

          {status === 'loading' && <p className="text-sm text-muted">Loading your pictures...</p>}
          {status === 'error' && <p role="alert" className="zuri-notice is-danger text-sm text-danger">{note || 'The image library is only available inside the Zuri app.'}</p>}
          {status === 'ready' && items.length === 0 && (
            <div className="flex flex-col items-start gap-3 py-8">
              <p className="text-sm text-muted">No pictures yet. Describe one in a chat, then choose a picture model from the + menu.</p>
              <Button variant="secondary" onPress={() => onNavigate?.('chats')}>Start a chat</Button>
            </div>
          )}
          {status === 'ready' && items.length > 0 && matches.length === 0 && <p className="text-sm text-muted">No picture matches that search.</p>}

          {matches.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {matches.slice(0, shown).map((item) => (
                <Tile key={item.name} item={item} api={api} onOpen={(picked, url) => setOpen({ item: picked, url })} />
              ))}
            </div>
          )}
          {matches.length > shown && (
            <div className="flex justify-center">
              <Button variant="ghost" onPress={() => setShown((count) => count + PAGE_SIZE)}>Show more</Button>
            </div>
          )}
        </div>
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Picture" className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
          <div className="flex items-center justify-end p-3">
            <Button isIconOnly variant="ghost" aria-label="Close" onPress={close}><CloseIcon size={18} /></Button>
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 md:flex-row">
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {open.url !== '' ? <img src={open.url} alt={open.item.prompt} className="max-h-[70dvh] max-w-full rounded-xl object-contain" /> : <p className="text-sm text-muted">Loading...</p>}
            </div>
            <aside className="flex w-full flex-col gap-4 md:w-72">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Your description</p>
                <p className="mt-1 text-sm">{open.item.prompt || 'Not recorded'}</p>
              </div>
              {open.item.usedPrompt !== '' && open.item.usedPrompt !== open.item.prompt && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">What Zuri sent to the picture maker</p>
                  <p className="mt-1 text-sm text-muted">{open.item.usedPrompt}</p>
                </div>
              )}
              <p className="text-xs text-muted">{whenLabel(open.item.createdAt)}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onPress={makeAnother}><RegenerateIcon size={14} />Make another</Button>
                <Button variant="secondary" onPress={() => void savePicture()}><DownloadIcon size={14} />Save as</Button>
                <Button variant="ghost" onPress={() => void copyPicture()}><CopyIcon size={14} />Copy</Button>
                <Button variant="ghost" onPress={() => void deletePicture()}><DeleteIcon size={14} />{confirmDelete ? 'Confirm delete' : 'Delete'}</Button>
              </div>
              {note !== '' && <p role="status" className="text-xs text-muted">{note}</p>}
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
