import { useEffect, useState } from 'react';
import { Button, Chip, Input } from '@heroui/react';

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatModified(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function fileType(name) {
  const extension = name.split('.').pop()?.toUpperCase();
  return extension && extension !== name.toUpperCase() ? extension : 'FILE';
}

export default function FilesView() {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [files, setFiles] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [busyPath, setBusyPath] = useState('');
  const [summaryPath, setSummaryPath] = useState('');
  const [instruction, setInstruction] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');

  async function reload() {
    if (typeof api?.files?.list !== 'function') {
      setStatus('error');
      setMessage('File data is only available when this page runs inside the Zuri app.');
      return;
    }
    setStatus('loading');
    try {
      const result = await api.files.list({});
      if (!result?.ok) {
        setStatus('error');
        setMessage(result?.error?.message ?? 'The workspace folder could not be read.');
        return;
      }
      setFiles(Array.isArray(result.data?.files) ? result.data.files : []);
      setTruncated(result.data?.truncated === true);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error?.message ?? 'The workspace folder could not be read.');
    }
  }

  useEffect(() => {
    void reload();
    if (typeof api?.app?.info === 'function') {
      void api.app.info().then((result) => {
        if (result?.userData) setWorkspacePath(`${result.userData}\\workspace`);
      });
    }
    const unsubscribe = api?.state?.onChanged?.((change) => {
      if (change?.area === undefined || change.area === 'files') void reload();
    });
    return () => unsubscribe?.();
    // The bridge is stable for the lifetime of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(path, action) {
    const method = action === 'open' ? api?.files?.open : api?.files?.reveal;
    if (typeof method !== 'function') return;
    setBusyPath(path);
    const result = await method({ path });
    setBusyPath('');
    setMessage(result?.ok ? (action === 'open' ? `Opened ${path}.` : `Showing ${path} in Explorer.`) : result?.error?.message ?? `Could not ${action} ${path}.`);
  }

  async function revealFolder() {
    await act('.', 'reveal');
  }

  async function chooseSummary() {
    if (typeof api?.files?.choose !== 'function' || typeof api?.files?.summarize !== 'function') return;
    const picked = await api.files.choose({ purpose: 'summarize' });
    if (!picked?.ok || picked.data?.cancelled) return;
    setSummaryPath(picked.data.path);
    setMessage(`Selected ${picked.data.name}. Add an instruction or summarize it.`);
  }

  async function summarize() {
    if (summaryPath === '' || typeof api?.files?.summarize !== 'function') return;
    setBusyPath(summaryPath);
    const result = await api.files.summarize({ path: summaryPath, instruction });
    setBusyPath('');
    if (!result?.ok) {
      setMessage(result?.error?.message ?? 'The document could not be summarized.');
      return;
    }
    setSummaryPath('');
    setInstruction('');
    setMessage(`Saved ${result.data?.name ?? 'the summary'} to the workspace.`);
    await reload();
  }

  const totalBytes = files.reduce((sum, file) => sum + (Number(file?.bytes) || 0), 0);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col overflow-y-auto px-6 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Office files</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">Everything in your workspace folder. Open a document or reveal it in Explorer.</p>
          </div>
          <Button variant="primary" onPress={() => void reload()} isDisabled={status === 'loading'}>Refresh</Button>
        </header>

        <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3">
          <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-muted">Workspace folder</p><p className="truncate text-sm">{workspacePath || 'Zuri workspace'}</p></div>
          <Button size="sm" variant="ghost" onPress={() => void revealFolder()} isDisabled={busyPath !== ''}>Reveal folder</Button>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5" aria-label="Files in the workspace folder">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-medium">Workspace files</h2><span className="text-sm text-muted">{files.length} file{files.length === 1 ? '' : 's'}{totalBytes > 0 ? ` - ${formatSize(totalBytes)}` : ''}</span></div>
          {status === 'loading' && <p className="text-sm text-muted">Reading the workspace folder...</p>}
          {status === 'error' && <p role="alert" className="text-sm text-danger">{message}</p>}
          {status === 'ready' && files.length === 0 && <p className="text-sm text-muted">No files in your workspace yet. Anything Act saves appears here.</p>}
          {status === 'ready' && files.length > 0 && <ul className="flex flex-col gap-2">{files.map((file) => <li key={file.path} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"><Chip size="sm">{fileType(file.name)}</Chip><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-muted">{formatSize(file.bytes)}{formatModified(file.modifiedAt) ? ` - ${formatModified(file.modifiedAt)}` : ''}</p></div><Button size="sm" variant="ghost" onPress={() => void act(file.path, 'open')} isDisabled={busyPath !== ''}>Open</Button><Button size="sm" variant="ghost" onPress={() => void act(file.path, 'reveal')} isDisabled={busyPath !== ''}>Reveal</Button></li>)}</ul>}
          {truncated && <p className="mt-3 text-xs text-muted">The list is limited to the first workspace files.</p>}
          {message && status === 'ready' && <p role="status" className="mt-4 text-sm text-muted">{message}</p>}
        </section>

        <section className="mt-5 rounded-xl border border-border bg-surface p-5">
          <div className="mb-3"><h2 className="text-lg font-medium">Summarize a document</h2><p className="mt-1 text-sm text-muted">Choose a document and save its summary back into the workspace.</p></div>
          <div className="flex flex-wrap items-end gap-2"><Button variant="secondary" onPress={() => void chooseSummary()} isDisabled={busyPath !== ''}>Choose document</Button>{summaryPath && <span className="max-w-sm truncate text-sm text-muted">{summaryPath}</span>}</div>
          {summaryPath && <div className="mt-3 flex flex-wrap items-end gap-2"><Input label="Optional instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} className="min-w-64 flex-1" /><Button variant="primary" onPress={() => void summarize()} isDisabled={busyPath !== ''}>Summarize</Button></div>}
        </section>
      </div>
    </main>
  );
}
