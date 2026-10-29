import { useEffect, useState } from 'react';
import { Button, Chip, Input } from './ui.jsx';

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

const OFFICE_TYPE_LABELS = { DOCX: 'WORD', XLSX: 'EXCEL', PPTX: 'POWERPOINT' };

function fileType(name) {
  const extension = name.split('.').pop()?.toUpperCase();
  if (!extension || extension === name.toUpperCase()) return 'FILE';
  return OFFICE_TYPE_LABELS[extension] ?? extension;
}

// The renderer is sandboxed and cannot import node:path, so the workspace folder
// is joined with the separator app.info reports for this platform.
function workspaceFolderPath(userData, platform) {
  if (typeof userData !== 'string' || userData.trim() === '') return '';
  const base = userData.replace(/[\\/]+$/, '');
  return `${base}${platform === 'win32' ? '\\' : '/'}workspace`;
}

function fileMeta(file) {
  return [formatSize(file?.bytes), formatModified(file?.modifiedAt)].filter(Boolean).join(' - ');
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
        setWorkspacePath(workspaceFolderPath(result?.userData, result?.platform));
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
    setMessage(result?.ok ? (action === 'open' ? `Opened ${path}.` : `Showing ${path} in your file manager.`) : result?.error?.message ?? `Could not ${action} ${path}.`);
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
  const countLine = `${files.length} file${files.length === 1 ? '' : 's'}${totalBytes > 0 ? `, ${formatSize(totalBytes)}` : ''}`;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-medium tracking-tight">Office files</h1>
              <p className="mt-1 text-sm text-muted">Documents in your workspace folder. Open one, or show it in your file manager.</p>
            </div>
            <Button variant="ghost" className="ml-auto" onPress={() => void revealFolder()} isDisabled={busyPath !== ''}>Reveal folder</Button>
          </header>

          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Workspace folder</span>
            <p className="min-w-0 flex-1 truncate font-mono text-sm" title={workspacePath || undefined}>{workspacePath || 'Zuri workspace'}</p>
          </div>

          <section>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium text-muted">Files</h2>
              {status === 'ready' && <span className="text-sm text-muted">{countLine}</span>}
            </div>

            {status === 'loading' && <p className="text-sm text-muted">Reading the workspace folder...</p>}
            {status === 'error' && <p role="alert" className="zuri-notice is-danger text-sm text-danger">{message}</p>}

            {status === 'ready' && files.length === 0 && (
              <div className="zuri-empty-state">
                <strong>No files yet</strong>
                <p>Anything Zuri saves appears here.</p>
                <Button variant="ghost" onPress={() => void revealFolder()} isDisabled={busyPath !== ''}>Reveal folder</Button>
              </div>
            )}

            {status === 'ready' && files.length > 0 && (
              <ul className="flex flex-col divide-y divide-border border-t border-border">
                {files.map((file) => (
                  <li key={file.path} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <Chip size="sm">{fileType(file.name)}</Chip>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted">{fileMeta(file)}</p>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
                      <Button size="sm" variant="ghost" onPress={() => void act(file.path, 'open')} isDisabled={busyPath !== ''}>Open</Button>
                      <Button size="sm" variant="ghost" onPress={() => void act(file.path, 'reveal')} isDisabled={busyPath !== ''}>Reveal</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {truncated && <p className="zuri-notice is-warning mt-3 text-xs text-warning">The list is limited to the first workspace files.</p>}
            {status === 'ready' && message !== '' && <p role="status" className="mt-4 text-sm text-muted">{message}</p>}
          </section>

          <section className="border-t border-border pt-5">
            <h2 className="text-sm font-medium text-muted">Summarise a document</h2>
            <p className="mt-1 text-sm text-muted">Choose a document and save its summary back into the workspace.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onPress={() => void chooseSummary()} isDisabled={busyPath !== ''}>Choose document</Button>
              {summaryPath && <span className="max-w-sm truncate text-sm text-muted">{summaryPath}</span>}
            </div>
            {summaryPath && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Input label="Optional instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} className="min-w-64 flex-1" />
                <Button variant="primary" onPress={() => void summarize()} isDisabled={busyPath !== ''}>Summarise</Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
