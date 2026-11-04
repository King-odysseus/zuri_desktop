import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Input, Textarea } from '../components/ui.jsx';
import {
  addProjectFile,
  createProject,
  deleteProject,
  deleteProjectFile,
  fetchProject,
  fetchProjects,
  signUpload,
  updateProject,
  uploadAttachment,
} from '../lib/api.js';
import { formatRelativeTime } from '../lib/format.js';
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  PlusIcon,
} from '../../../src/renderer-react/Icons.jsx';

/*
 * The server's limits, repeated here so a long name or a huge note is refused in
 * the form rather than after a round trip.
 */
const NAME_MAX_LENGTH = 60;
const INSTRUCTIONS_MAX_LENGTH = 4000;
/** What one text file may contribute: the words travel inside the project row. */
const TEXT_MAX_CHARACTERS = 20_000;
/** The same cap the chat screen uses, so a project file is never bigger than a chat one. */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** The kinds Cloudinary is signed for. */
const UPLOAD_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
/** A file this small and this plain is kept as text, which stays searchable. */
const TEXT_FILE_NAME = /\.(txt|md|csv|json)$/i;

/** A picture has no useful text, so its bytes go to the CDN instead. */
function isTextFile(file) {
  const type = typeof file?.type === 'string' ? file.type : '';
  return type.startsWith('text/') || TEXT_FILE_NAME.test(file?.name ?? '');
}

/**
 * Extract a bounded amount of selectable PDF text in the browser. OCR stays off:
 * scanned PDFs are intentionally refused because OCR would add provider/runtime
 * cost and can make a phone work for an unbounded amount of time.
 */
async function extractPdfText(file) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const { parseOffice } = await import('officeparser');
    const ast = await parseOffice(file, {
      fileType: 'pdf',
      ocr: false,
      abortSignal: controller.signal,
    });
    const text = typeof ast?.toText === 'function' ? ast.toText() : '';
    return typeof text === 'string' ? text.trim().slice(0, TEXT_MAX_CHARACTERS) : '';
  } finally {
    window.clearTimeout(timeout);
  }
}

/** "12 KB", "1.4 MB", or the character count of a text file the project holds. */
function sizeLabel(file) {
  const bytes = Math.max(0, Math.floor(Number(file?.bytes) || 0));
  if (bytes > 0) {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  const characters = Math.max(0, Math.floor(Number(file?.contentLength) || 0));
  if (characters > 0) return `${characters.toLocaleString('en-NG')} characters`;
  return 'Size not recorded';
}

/** "3 chats, 2 files", with the singular forms spelled out. */
function countsLabel(chats, files) {
  const chatWord = chats === 1 ? 'chat' : 'chats';
  const fileWord = files === 1 ? 'file' : 'files';
  return `${chats} ${chatWord}, ${files} ${fileWord}`;
}

/** A stored date in the chat list's own words, or the empty string when unusable. */
function whenLabel(value) {
  return value ? formatRelativeTime(value) : '';
}

/**
 * Projects: a folder each chat can be filed into.
 *
 * One screen with two states, because the list and the open project share the same
 * data and a route change to read one project would lose the scroll position of
 * the list. The list loads on mount; a project's files and chats load when it is
 * opened, so a customer with many projects reads only what they asked for.
 *
 * @param {{ onStartChat?: (projectId: string) => void }} props
 */
export default function ProjectsView({ onStartChat }) {
  // List state
  const [listStatus, setListStatus] = useState('loading');
  const [listError, setListError] = useState('');
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  // Open project state
  const [openId, setOpenId] = useState(null);
  const [detailStatus, setDetailStatus] = useState('idle');
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState({ project: {}, files: [], conversations: [] });
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [instructionsBusy, setInstructionsBusy] = useState(false);
  const [instructionsError, setInstructionsError] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [confirmFileId, setConfirmFileId] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmProject, setConfirmProject] = useState(false);

  const loadProjects = useCallback(async () => {
    setListStatus('loading');
    setListError('');
    try {
      setProjects(await fetchProjects());
      setListStatus('ready');
    } catch (error) {
      // The server's own sentence is the one worth showing: it names the reason.
      setListError(error?.message || 'Your projects could not be loaded.');
      setListStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  /** Read one project's files and chats. Used on open and after a change lands. */
  const loadProject = useCallback(async (id) => {
    setDetailStatus('loading');
    setDetailError('');
    try {
      const data = await fetchProject(id);
      // A slow answer for a project that has since been left must not paint over the
      // one now on screen, so a reply for a different project keeps what is there.
      setDetail((current) => (current.project?.id && current.project.id !== id ? current : data));
      setDetailStatus('ready');
      return data;
    } catch (error) {
      setDetailError(error?.message || 'That project could not be opened.');
      setDetailStatus('error');
      return null;
    }
  }, []);

  const closeProject = useCallback(() => {
    setOpenId(null);
    setDetailStatus('idle');
    setDetailError('');
    setDetail({ project: {}, files: [], conversations: [] });
    setEditingInstructions(false);
    setInstructionsError('');
    setFileNote('');
    setConfirmFileId('');
    setConfirmProject(false);
  }, []);

  const openProject = useCallback(
    async (id) => {
      setOpenId(id);
      setDetail({ project: { id, name: '', fileCount: 0, conversationCount: 0 }, files: [], conversations: [] });
      setEditingInstructions(false);
      setInstructionsError('');
      setFileNote('');
      setConfirmFileId('');
      setConfirmProject(false);
      await loadProject(id);
    },
    [loadProject],
  );

  const submitNewProject = useCallback(
    async (event) => {
      event.preventDefault();
      const name = newName.trim();
      if (name === '') {
        setCreateError('Give the project a name first.');
        return;
      }
      setCreateBusy(true);
      setCreateError('');
      try {
        const project = await createProject(name, newInstructions);
        if (project?.id) {
          setProjects((rows) => [project, ...rows.filter((row) => row.id !== project.id)]);
          setCreating(false);
          setNewName('');
          setNewInstructions('');
          // Opening it straight away puts the next step (instructions, files) in
          // front of the person instead of making them find the new card.
          await openProject(project.id);
        } else {
          await loadProjects();
          setCreating(false);
          setNewName('');
          setNewInstructions('');
        }
      } catch (error) {
        setCreateError(error?.message || 'That project could not be created.');
      } finally {
        setCreateBusy(false);
      }
    },
    [loadProjects, newInstructions, newName, openProject],
  );

  const saveInstructions = useCallback(async () => {
    const id = detail.project?.id;
    if (!id) return;
    setInstructionsBusy(true);
    setInstructionsError('');
    try {
      // An empty textarea clears the instructions, which is a real choice and not a
      // missing value, so it is sent as the empty string it is.
      const project = await updateProject(id, { instructions: instructionsDraft });
      setDetail((current) => ({ ...current, project: { ...current.project, ...project } }));
      setProjects((rows) => rows.map((row) => (row.id === id ? { ...row, ...project } : row)));
      setEditingInstructions(false);
    } catch (error) {
      setInstructionsError(error?.message || 'Those instructions could not be saved.');
    } finally {
      setInstructionsBusy(false);
    }
  }, [detail.project, instructionsDraft]);

  const beginEditingInstructions = useCallback(() => {
    setInstructionsDraft(String(detail.project?.instructions ?? ''));
    setInstructionsError('');
    setEditingInstructions(true);
  }, [detail.project]);

  /**
   * Add one file to the open project.
   *
   * Two routes, as in the chat composer: a picture is uploaded to Cloudinary,
   * while text and selectable PDF files are read here and their bounded words are
   * stored. A PDF is kept as text rather than as a link so every client can use the
   * same project context without downloading or re-parsing it on every question.
   */
  const chooseFile = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      // Cleared at once so choosing the same file twice still fires a change.
      event.target.value = '';
      const id = detail.project?.id;
      if (!file || !id) return;

      setFileNote('');
      if (isTextFile(file)) {
        setFileBusy(true);
        try {
          const text = await file.text();
          const content = text.slice(0, TEXT_MAX_CHARACTERS);
          await addProjectFile(id, { name: file.name, kind: 'text/plain', content });
          // The reloaded project carries the new count and the server's own view of
          // the file, so the row and the "2 files" line can never disagree.
          await loadProject(id);
          if (text.length > TEXT_MAX_CHARACTERS) {
            setFileNote(`Only the first ${TEXT_MAX_CHARACTERS.toLocaleString('en-NG')} characters of that file were kept.`);
          }
        } catch (error) {
          setFileNote(error?.message || 'That file could not be added. Try again.');
        } finally {
          setFileBusy(false);
        }
        return;
      }

      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        if (file.size > UPLOAD_MAX_BYTES) {
          setFileNote('That file is over 10MB. Try a smaller one.');
          return;
        }
        setFileBusy(true);
        try {
          const content = await extractPdfText(file);
          if (content === '') {
            setFileNote('That PDF has no selectable text. Scanned PDFs are not supported yet.');
            return;
          }
          await addProjectFile(id, { name: file.name, kind: 'application/pdf', bytes: file.size, content });
          await loadProject(id);
          setFileNote(content.length >= TEXT_MAX_CHARACTERS
            ? `Only the first ${TEXT_MAX_CHARACTERS.toLocaleString('en-NG')} characters of that PDF were kept.`
            : 'PDF text extracted and added to the project.');
        } catch (error) {
          setFileNote(error?.name === 'AbortError'
            ? 'That PDF took too long to read. Try a smaller or simpler file.'
            : 'That PDF could not be read. It may be encrypted or malformed.');
        } finally {
          setFileBusy(false);
        }
        return;
      }

      if (!UPLOAD_TYPES.test(file.type)) {
        setFileNote('A project file can be a picture, a PDF or a text file.');
        return;
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        setFileNote('That file is over 10MB. Try a smaller one.');
        return;
      }

      setFileBusy(true);
      try {
        const signed = await signUpload();
        if (!signed?.signature) {
          setFileNote('Attachments are not switched on for this deployment yet. A text file still works.');
          return;
        }
        const uploaded = await uploadAttachment(file, signed);
        await addProjectFile(id, {
          name: uploaded.name,
          kind: uploaded.kind,
          bytes: uploaded.bytes,
          url: uploaded.url,
        });
        await loadProject(id);
      } catch (error) {
        // A deployment with no Cloudinary answers 503 from the signing route, and
        // saying that plainly is more useful than repeating the status code.
        if (Number(error?.status) === 503) {
          setFileNote('Attachments are not switched on for this deployment yet. A text file still works.');
          return;
        }
        setFileNote(error?.message || 'That file could not be added. Try again.');
      } finally {
        setFileBusy(false);
      }
    },
    [detail.project, loadProject],
  );

  const removeFile = useCallback(
    async (fileId) => {
      const id = detail.project?.id;
      if (!id || !fileId) return;
      setFileBusy(true);
      setFileNote('');
      try {
        await deleteProjectFile(id, fileId);
        setDetail((current) => ({
          ...current,
          files: current.files.filter((file) => file.id !== fileId),
          project: {
            ...current.project,
            fileCount: Math.max(0, Math.floor(Number(current.project?.fileCount) || 0) - 1),
          },
        }));
        setConfirmFileId('');
      } catch (error) {
        setFileNote(error?.message || 'That file could not be deleted.');
      } finally {
        setFileBusy(false);
      }
    },
    [detail.project],
  );

  const removeProject = useCallback(async () => {
    const id = detail.project?.id;
    if (!id) return;
    setDeleteBusy(true);
    setDetailError('');
    try {
      await deleteProject(id);
      setProjects((rows) => rows.filter((row) => row.id !== id));
      setConfirmProject(false);
      closeProject();
    } catch (error) {
      setDeleteBusy(false);
      setDetailError(error?.message || 'That project could not be deleted.');
      return;
    }
    setDeleteBusy(false);
  }, [closeProject, detail.project]);

  // ------------------------------------------------------------------ list state
  if (openId === null) {
    return (
      <section className="view project-view">
        <div className="view-head">
          <div>
            <h1>Projects</h1>
            <p>
              A project keeps one set of instructions and a few reference files, so every chat inside it
              starts with the same context.
            </p>
          </div>
          <div className="project-head-actions">
            <Button variant="secondary" onClick={() => { setCreating((open) => !open); setCreateError(''); }}>
              <FolderPlusIcon size={16} aria-hidden="true" />
              New project
            </Button>
          </div>
        </div>

        {listStatus === 'error' && (
          <InlineAlert tone="danger">
            {listError}
          </InlineAlert>
        )}

        {creating && (
          <form className="card project-form" onSubmit={(event) => void submitNewProject(event)}>
            <p className="project-form-title">New project</p>
            <div className="project-field">
              <label className="project-field-label" htmlFor="project-new-name">
                Name
              </label>
              <Input
                id="project-new-name"
                className="project-input"
                maxLength={NAME_MAX_LENGTH}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Client work, Thesis, Launch plan"
                autoFocus
              />
              <p className="project-form-note">Up to {NAME_MAX_LENGTH} characters.</p>
            </div>
            <div className="project-field">
              <label className="project-field-label" htmlFor="project-new-instructions">
                Instructions (optional)
              </label>
              <Textarea
                id="project-new-instructions"
                className="project-textarea"
                rows={4}
                maxLength={INSTRUCTIONS_MAX_LENGTH}
                value={newInstructions}
                onChange={(event) => setNewInstructions(event.target.value)}
                placeholder="Who the writing is for, the tone to use, names and facts Zuri should not get wrong."
              />
              <p className="project-form-note">
                {newInstructions.length.toLocaleString('en-NG')} of{' '}
                {INSTRUCTIONS_MAX_LENGTH.toLocaleString('en-NG')} characters.
              </p>
            </div>
            {createError && (
              <InlineAlert tone="danger">
                {createError}
              </InlineAlert>
            )}
            <div className="project-form-actions">
              <Button type="submit" isDisabled={createBusy || newName.trim() === ''}>
                {createBusy ? 'Creating...' : 'Save project'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                isDisabled={createBusy}
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                  setNewInstructions('');
                  setCreateError('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {listStatus === 'loading' && <p className="project-loading">Loading your projects...</p>}

        {listStatus === 'ready' && projects.length === 0 && (
          <div className="project-empty">
            <p>No projects yet. Open one to keep its instructions and files together.</p>
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <FolderPlusIcon size={16} aria-hidden="true" />
              New project
            </Button>
          </div>
        )}

        {projects.length > 0 && (
          <div className="project-grid">
            {projects.map((project) => {
              const chats = Math.max(0, Math.floor(Number(project?.conversationCount) || 0));
              const files = Math.max(0, Math.floor(Number(project?.fileCount) || 0));
              return (
                <Button
                  type="button"
                  variant="ghost"
                  className="project-card"
                  key={project.id}
                  onClick={() => void openProject(project.id)}
                >
                  <span className="project-card-icon">
                    <FolderIcon size={20} aria-hidden="true" />
                  </span>
                  <span className="project-card-name">{project.name || 'Untitled project'}</span>
                  <span className="project-card-meta">{countsLabel(chats, files)}</span>
                </Button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  // -------------------------------------------------------------- open project
  const project = detail.project ?? {};
  const files = Array.isArray(detail.files) ? detail.files : [];
  const chats = Array.isArray(detail.conversations) ? detail.conversations : [];
  const instructions = String(project.instructions ?? '').trim();
  const chatsInProject = Number.isFinite(Number(project.conversationCount))
    ? Math.floor(Number(project.conversationCount))
    : chats.length;
  const filesInProject = Number.isFinite(Number(project.fileCount))
    ? Math.floor(Number(project.fileCount))
    : files.length;

  return (
    <section className="view project-view">
      <div className="view-head">
        <div>
          <Button type="button" variant="ghost" className="project-back" onClick={closeProject}>
            <ChevronLeftIcon size={16} aria-hidden="true" />
            All projects
          </Button>
          <h1>{project.name || 'Project'}</h1>
          <p className="project-meta">{countsLabel(chatsInProject, filesInProject)}</p>
        </div>
      </div>

      {detailStatus === 'error' && (
        <InlineAlert tone="danger">
          {detailError}
        </InlineAlert>
      )}
      {detailStatus === 'loading' && <p className="project-loading">Opening this project...</p>}

      <article className="card project-section">
        <div className="project-section-head">
          <h2 className="project-section-title">Instructions</h2>
          {!editingInstructions && (
            <Button variant="ghost" onClick={beginEditingInstructions}>
              <EditIcon size={14} aria-hidden="true" />
              Edit
            </Button>
          )}
        </div>
        <p className="project-section-note">
          Added to every chat in this project, so tone and facts do not have to be repeated.
        </p>

        {editingInstructions ? (
          <form
            className="project-instructions-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveInstructions();
            }}
          >
            <label className="project-field-label" htmlFor="project-instructions">
              Instructions for this project
            </label>
            <Textarea
              id="project-instructions"
              className="project-textarea"
              rows={5}
              maxLength={INSTRUCTIONS_MAX_LENGTH}
              value={instructionsDraft}
              onChange={(event) => setInstructionsDraft(event.target.value)}
              placeholder="Who the writing is for, the tone to use, names and facts Zuri should not get wrong."
              autoFocus
            />
            <p className="project-form-note">
              {instructionsDraft.length.toLocaleString('en-NG')} of{' '}
              {INSTRUCTIONS_MAX_LENGTH.toLocaleString('en-NG')} characters.
            </p>
            {instructionsError && (
              <InlineAlert tone="danger">
                {instructionsError}
              </InlineAlert>
            )}
            <div className="project-form-actions">
              <Button type="submit" isDisabled={instructionsBusy}>
                <CheckIcon size={14} aria-hidden="true" />
                {instructionsBusy ? 'Saving...' : 'Save instructions'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                isDisabled={instructionsBusy}
                onClick={() => {
                  setEditingInstructions(false);
                  setInstructionsError('');
                }}
              >
                <CloseIcon size={14} aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="project-instructions">
            {instructions === ''
              ? 'No instructions yet. Zuri answers these chats with no extra context.'
              : instructions}
          </p>
        )}
      </article>

      <article className="card project-section">
        <div className="project-section-head">
          <h2 className="project-section-title">Files</h2>
          <Button
            type="button"
            variant="secondary"
            className="project-file-button"
            isDisabled={fileBusy}
            onPress={() => fileInputRef.current?.click()}
          >
            <PlusIcon size={14} aria-hidden="true" />
            Add a file
          </Button>
        </div>
        <p className="project-section-note">
          Reference material Zuri can use in this project: a picture, a PDF or a short text file.
        </p>
        <input
          ref={fileInputRef}
          id="project-file-input"
          type="file"
          className="sr-only project-file-input"
          aria-label="Add a file to this project"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json"
          disabled={fileBusy}
          onChange={(event) => void chooseFile(event)}
        />

        {fileNote && (
          <InlineAlert>
            {fileNote}
          </InlineAlert>
        )}

        {files.length === 0 ? (
          <p className="project-file-empty">No files yet. Zuri answers from the chat alone until one is added.</p>
        ) : (
          <ul className="project-file-list">
            {files.map((file) => (
              <li className="project-file" key={file.id}>
                <span className="project-file-icon">
                  <FileIcon size={16} aria-hidden="true" />
                </span>
                <span className="project-file-name">
                  {file.url ? (
                    <a className="project-file-link" href={file.url} target="_blank" rel="noreferrer">
                      {file.name || 'Untitled file'}
                    </a>
                  ) : (
                    file.name || 'Untitled file'
                  )}
                </span>
                <span className="project-file-meta">{sizeLabel(file)}</span>
                <span className="project-file-actions">
                  <Button
                    variant="ghost"
                    isDisabled={fileBusy}
                    aria-label={
                      confirmFileId === file.id
                        ? `Confirm deleting ${file.name || 'this file'}`
                        : `Delete ${file.name || 'this file'}`
                    }
                    onClick={() => {
                      // Two presses: the first arms this row, the second removes the
                      // file, so one stray click cannot lose a reference document.
                      if (confirmFileId === file.id) void removeFile(file.id);
                      else setConfirmFileId(file.id);
                    }}
                  >
                    <DeleteIcon size={14} aria-hidden="true" />
                    {confirmFileId === file.id ? 'Confirm delete' : 'Delete'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card project-section">
        <div className="project-section-head">
          <h2 className="project-section-title">Chats in this project</h2>
          <Button
            variant="secondary"
            onClick={() => onStartChat?.(project)}
            isDisabled={!project.id || typeof onStartChat !== 'function'}
          >
            <PlusIcon size={14} aria-hidden="true" />
            New chat in this project
          </Button>
        </div>
        <p className="project-section-note">
          Every chat here answers with the instructions and files above, and stays filed under this project.
        </p>

        {chats.length === 0 ? (
          <p className="project-chat-empty">No chats in this project yet.</p>
        ) : (
          <ul className="project-chat-list">
            {chats.map((conversation) => (
              <li className="project-chat" key={conversation.id}>
                <span className="project-chat-title">{conversation.title || 'New chat'}</span>
                <span className="project-chat-date">
                  {whenLabel(conversation.updatedAt ?? conversation.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card project-section project-danger">
        <p className="project-danger-note">
          Deleting this project removes it, its instructions and its reference files. It cannot be undone.
        </p>
        <Button
          variant="ghost"
          isDisabled={deleteBusy || !project.id}
          onClick={() => {
            if (confirmProject) void removeProject();
            else setConfirmProject(true);
          }}
        >
          <DeleteIcon size={14} aria-hidden="true" />
          {confirmProject ? 'Confirm delete project' : 'Delete project'}
        </Button>
        {confirmProject && (
          <Button variant="ghost" isDisabled={deleteBusy} onClick={() => setConfirmProject(false)}>
            Keep it
          </Button>
        )}
      </article>
    </section>
  );
}
