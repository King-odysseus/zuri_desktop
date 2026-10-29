import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, InlineAlert } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { blobFromBase64, deletePicture, listPictures, savePicture } from '../lib/imageStore.js';
import { DeleteIcon, DownloadIcon, ImageIcon, RegenerateIcon } from '../components/Icons.jsx';

const SHAPES = [['square', 'Square'], ['portrait', 'Portrait'], ['landscape', 'Landscape']];
const IMPROVE_KEY = 'zuri-improve-image-prompt';

function readImprove() {
  try {
    return window.localStorage.getItem(IMPROVE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** A short file name for a download, taken from the words that drew the picture. */
function fileNameFor(picture) {
  const words = (picture.prompt || 'picture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `zuri-${words || 'picture'}.${picture.blob.type === 'image/jpeg' ? 'jpg' : picture.blob.type === 'image/webp' ? 'webp' : 'png'}`;
}

/**
 * Make pictures and keep them on this device.
 *
 * The server draws a picture and sends it back once. It is stored in this browser
 * (or this phone) only, so the library is private and survives without the cloud.
 */
export default function ImagesView() {
  const [models, setModels] = useState([]);
  const [modelCode, setModelCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [shape, setShape] = useState('square');
  const [improve, setImprove] = useState(readImprove);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pictures, setPictures] = useState([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const reload = useCallback(async () => {
    try {
      setPictures(await listPictures());
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    void reload();
    let active = true;
    void (async () => {
      try {
        const listed = await api('/api/models');
        if (!active) return;
        const drawing = (Array.isArray(listed) ? listed : []).filter((model) => model.kind === 'image');
        setModels(drawing);
        setModelCode((current) => current || (drawing.find((model) => model.available) ?? drawing[0])?.code || '');
      } catch (loadError) {
        if (active) setError(loadError.message);
      }
    })();
    return () => { active = false; };
  }, [reload]);

  // Object URLs for the tiles, released when the list changes so a long library
  // does not hold every picture in memory twice.
  const urls = useMemo(() => new Map(pictures.map((picture) => [picture.id, URL.createObjectURL(picture.blob)])), [pictures]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === '' ? pictures : pictures.filter((picture) => `${picture.prompt} ${picture.usedPrompt}`.toLowerCase().includes(needle));
  }, [pictures, query]);
  const open = pictures.find((picture) => picture.id === openId) ?? null;

  async function make(event) {
    event?.preventDefault();
    const text = prompt.trim();
    if (text === '' || modelCode === '' || busy) return;
    setBusy(true);
    setError('');
    try {
      const made = await api('/api/images', { method: 'POST', body: JSON.stringify({ prompt: text, model: modelCode, shape, improve }) });
      await savePicture({
        blob: blobFromBase64(made.imageBase64, made.mime),
        prompt: text,
        usedPrompt: made.prompt ?? text,
        model: made.modelName ?? modelCode,
        shape,
      });
      await reload();
    } catch (makeError) {
      setError(makeError.message || 'The picture could not be made.');
    } finally {
      setBusy(false);
    }
  }

  function download(picture) {
    const link = document.createElement('a');
    link.href = urls.get(picture.id);
    link.download = fileNameFor(picture);
    link.click();
  }

  async function remove(id) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    await deletePicture(id);
    setConfirmId('');
    setOpenId('');
    await reload();
  }

  return (
    <section className="view image-view">
      <div className="view-head">
        <div>
          <h1>Images</h1>
          <p>Describe a picture and Zuri draws it. Pictures are kept on this device only, never on our servers.</p>
        </div>
      </div>

      <form className="image-maker" onSubmit={(event) => void make(event)}>
        <textarea
          className="project-textarea"
          rows={3}
          maxLength={2000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="A market in Lagos at sunset, painted in warm watercolours"
          aria-label="Describe the picture"
        />
        <div className="image-options">
          <select className="project-input" value={modelCode} onChange={(event) => setModelCode(event.target.value)} aria-label="Picture model">
            {models.map((model) => (
              <option key={model.code} value={model.code} disabled={!model.available}>
                {model.name}{model.available ? '' : ` (needs the ${model.minPlan} plan)`}
              </option>
            ))}
          </select>
          <div role="radiogroup" aria-label="Picture shape" className="image-shapes">
            {SHAPES.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={shape === value} className={`image-shape${shape === value ? ' is-active' : ''}`} onClick={() => setShape(value)}>
                {label}
              </button>
            ))}
          </div>
          <label className="image-improve">
            <input
              type="checkbox"
              checked={improve}
              onChange={(event) => {
                setImprove(event.target.checked);
                try { window.localStorage.setItem(IMPROVE_KEY, event.target.checked ? 'on' : 'off'); } catch { /* private browsing */ }
              }}
            />
            Improve my description
          </label>
          <Button type="submit" disabled={busy || prompt.trim() === '' || modelCode === ''}>
            <ImageIcon size={16} aria-hidden="true" />
            {busy ? 'Drawing...' : 'Make picture'}
          </Button>
        </div>
      </form>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      {pictures.length > 0 && (
        <input className="project-input image-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your pictures" aria-label="Search your pictures" />
      )}
      {pictures.length === 0 && <p className="project-empty">No pictures yet. Your first one will appear here.</p>}
      {pictures.length > 0 && shown.length === 0 && <p className="project-empty">No picture matches that search.</p>}

      <div className="image-grid">
        {shown.map((picture) => (
          <button key={picture.id} type="button" className="image-tile" onClick={() => { setOpenId(picture.id); setConfirmId(''); }} aria-label={`Open picture: ${picture.prompt}`}>
            <img src={urls.get(picture.id)} alt={picture.prompt} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>

      {open && (
        <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Picture" onKeyDown={(event) => { if (event.key === 'Escape') setOpenId(''); }}>
          <button type="button" className="image-viewer-close" onClick={() => setOpenId('')}>Close</button>
          <img src={urls.get(open.id)} alt={open.prompt} />
          <div className="image-viewer-info">
            <p className="project-field-label">Your description</p>
            <p>{open.prompt}</p>
            {open.usedPrompt && open.usedPrompt !== open.prompt && (
              <>
                <p className="project-field-label">What Zuri sent to the picture maker</p>
                <p className="project-section-note">{open.usedPrompt}</p>
              </>
            )}
            <div className="project-form-actions">
              <Button onClick={() => { setPrompt(open.prompt); setOpenId(''); window.scrollTo({ top: 0 }); }}>
                <RegenerateIcon size={14} aria-hidden="true" />
                Make another
              </Button>
              <Button variant="secondary" onClick={() => download(open)}>
                <DownloadIcon size={14} aria-hidden="true" />
                Download
              </Button>
              <Button variant="ghost" onClick={() => void remove(open.id)}>
                <DeleteIcon size={14} aria-hidden="true" />
                {confirmId === open.id ? 'Confirm delete' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
