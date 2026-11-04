import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, Textarea } from './ui.jsx';
import { DeleteIcon, EditIcon } from './Icons.jsx';

// Mirrors SKILL_MAX_ENABLED in src/main/store.js, which is the rule that is enforced;
// this copy only lets the page explain the limit before a switch is refused.
const MAX_ENABLED = 5;
// Mirrors SKILL_MAX_COUNT in src/main/store.js; this copy only explains a skipped skill.
const MAX_SKILLS = 20;

const STARTER_IDEAS = [
  { name: 'Plain English', instructions: 'Write in short, plain sentences. Avoid jargon, and explain any technical word the first time it appears.' },
  { name: 'Meeting notes', instructions: 'When I paste notes from a meeting, return: a one-line summary, the decisions made, and a list of actions with an owner for each.' },
  { name: 'Formal emails', instructions: 'When I ask for an email, write it politely and formally, with a clear subject line and a short closing.' },
];

/**
 * Skills: saved instructions that are added to every reply while they are switched on.
 * A skill costs tokens on every message, which is why only a few can be on at once.
 */
export default function SkillsView() {
  const [skills, setSkills] = useState([]);
  const [status, setStatus] = useState('loading');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [problem, setProblem] = useState('');
  // The skill whose text is in the form; '' means the form is adding a new one.
  const [editingId, setEditingId] = useState('');
  // The form is hidden until someone adds or edits, so the page opens as a plain list.
  const [formOpen, setFormOpen] = useState(false);
  // A null value means the first load: start with every saved skill selected.
  const [selectedSkillIds, setSelectedSkillIds] = useState(null);
  // The one-line result of sharing or importing, and whether a file dialog is open.
  const [packNote, setPackNote] = useState('');
  const [packBusy, setPackBusy] = useState(false);

  const zuriSkills = typeof window !== 'undefined' ? window.zuri?.skills : undefined;

  async function reload() {
    if (!zuriSkills) {
      // Running in a browser preview, outside Electron: there is no store to read.
      setStatus('error');
      return;
    }
    const result = await zuriSkills.list();
    if (result?.ok) {
      const nextSkills = Array.isArray(result.data) ? result.data : [];
      setSkills(nextSkills);
      setSelectedSkillIds((current) => (current === null ? nextSkills.map((skill) => skill.id) : current.filter((id) => nextSkills.some((skill) => skill.id === id))));
      setStatus('ready');
    } else {
      setStatus('error');
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setFormOpen(false);
    setEditingId('');
    setName('');
    setInstructions('');
  }

  /** Put a saved skill's text in the form so it can be corrected and saved again. */
  function startEditing(skill) {
    setProblem('');
    setFormOpen(true);
    setEditingId(skill.id);
    setName(skill.name);
    setInstructions(skill.instructions);
  }

  async function saveSkill(event) {
    event.preventDefault();
    if (!zuriSkills || name.trim() === '' || instructions.trim() === '') return;
    setProblem('');
    // Editing leaves the on/off switch alone: only the name and the text are sent.
    const saved = editingId === ''
      ? await zuriSkills.create({ name, instructions })
      : await zuriSkills.update({ skillId: editingId, name, instructions });
    if (!saved?.ok) {
      setProblem(saved?.error?.message ?? 'That skill could not be saved.');
      return;
    }
    resetForm();
    await reload();
  }

  async function toggle(skill, enabled) {
    setProblem('');
    const result = await zuriSkills.update({ skillId: skill.id, enabled });
    if (!result?.ok) setProblem(result?.error?.message ?? 'That change could not be saved.');
    await reload();
  }

  async function remove(skill) {
    if (!window.confirm(`Delete the skill "${skill.name}"?`)) return;
    await zuriSkills.delete({ skillId: skill.id });
    // Deleting the skill being edited would leave the form saving into nothing.
    if (skill.id === editingId) resetForm();
    await reload();
  }

  /**
   * Write every saved skill to a file, including the ones switched off: a pack is
   * a copy of the list, not just of what is currently in use.
   */
  async function shareSkills() {
    if (!zuriSkills || packBusy) return;
    setPackBusy(true);
    setProblem('');
    setPackNote('');
    try {
      const result = await zuriSkills.export({ packName: 'My skills', skillIds: selectedSkillIds ?? [] });
      if (!result?.ok) {
        setProblem(result?.error?.message ?? 'The skills could not be shared.');
        return;
      }
      if (result.data?.cancelled === true) return;
      setPackNote(`Shared ${result.data?.count ?? 0} skill${result.data?.count === 1 ? '' : 's'}.`);
    } finally {
      setPackBusy(false);
    }
  }

  /**
   * Add the skills from a file someone shared. Everything arrives switched off, so
   * the instructions are read before any of them changes a reply.
   */
  async function importSkills() {
    if (!zuriSkills || packBusy) return;
    setPackBusy(true);
    setProblem('');
    setPackNote('');
    try {
      const result = await zuriSkills.import();
      if (!result?.ok) {
        setProblem(result?.error?.message ?? 'That file could not be imported.');
        return;
      }
      if (result.data?.cancelled === true) return;
      const added = Number(result.data?.added) || 0;
      const skipped = Number(result.data?.duplicates) || 0;
      const overLimit = Number(result.data?.overLimit) || 0;
      const parts = [`${added} skill${added === 1 ? '' : 's'} added, all switched off.`];
      if (skipped > 0) parts.push(`${skipped} already saved.`);
      if (overLimit > 0) parts.push(`${overLimit} left out because only ${MAX_SKILLS} skills fit.`);
      setPackNote(parts.join(' '));
      await reload();
    } finally {
      setPackBusy(false);
    }
  }

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const chosenCount = selectedSkillIds?.length ?? skills.length;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-medium tracking-tight">Skills</h1>
              <p className="mt-2 text-sm text-muted">
                Saved instructions Zuri follows while they are on. Up to {MAX_ENABLED} can be on at once, because each one is added to every message you send.
              </p>
            </div>
            {!formOpen && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {/* Both file actions are useless with nothing saved, so they wait for the list. */}
                <Button
                  variant="ghost"
                  className="min-h-11"
                  isDisabled={status !== 'ready' || chosenCount === 0 || packBusy}
                  onPress={() => void shareSkills()}
                >
                  Share skills
                </Button>
                <Button variant="ghost" className="min-h-11" isDisabled={status !== 'ready' || packBusy} onPress={() => void importSkills()}>
                  Import
                </Button>
                <Button variant="primary" className="min-h-11" isDisabled={status !== 'ready'} onPress={() => { setProblem(''); setFormOpen(true); }}>
                  New skill
                </Button>
              </div>
            )}
          </header>

          {packNote !== '' && <p role="status" className="text-sm text-muted">{packNote}</p>}

          {status === 'error' && <p role="alert" className="text-sm text-danger">Skills need the Zuri desktop app.</p>}
          {problem !== '' && <p role="alert" className="text-sm text-danger">{problem}</p>}

          {formOpen && (
            <section className="border-b border-border pb-6">
              <h2 className="text-base font-semibold">{editingId === '' ? 'Add a skill' : 'Edit skill'}</h2>
              <form onSubmit={saveSkill} className="mt-3 flex flex-col gap-3">
                <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="For example, Plain English" fullWidth />
                <Textarea
                  label="What should Zuri do?"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  maxLength={1500}
                  rows={4}
                  placeholder="Describe how to write, what to include, or what to avoid."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="primary" className="min-h-11" isDisabled={status !== 'ready' || name.trim() === '' || instructions.trim() === ''}>
                    {editingId === '' ? 'Save skill' : 'Save changes'}
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-11" onPress={resetForm}>Cancel</Button>
                  {editingId === '' && STARTER_IDEAS.map((idea) => (
                    <Button
                      key={idea.name}
                      type="button"
                      variant="ghost"
                      className="min-h-11 text-xs text-muted"
                      onPress={() => {
                        setName(idea.name);
                        setInstructions(idea.instructions);
                      }}
                    >
                      Try: {idea.name}
                    </Button>
                  ))}
                </div>
              </form>
            </section>
          )}

          <section aria-label="Your skills">
            {status === 'ready' && skills.length === 0 && <p className="text-sm text-muted">No skills yet. Choose New skill and switch it on.</p>}
            <ul className="flex flex-col divide-y divide-border">
              {skills.map((skill) => (
                <li key={skill.id} className="flex flex-wrap items-start gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium">{skill.name}</h3>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{skill.instructions}</p>
                  </div>
                  <Checkbox
                    isSelected={(selectedSkillIds ?? []).includes(skill.id)}
                    onChange={(checked) => setSelectedSkillIds((current) => {
                      const selected = current ?? skills.map((entry) => entry.id);
                      return checked ? [...new Set([...selected, skill.id])] : selected.filter((id) => id !== skill.id);
                    })}
                    className="min-h-11"
                    aria-label={`${(selectedSkillIds ?? []).includes(skill.id) ? 'Remove' : 'Include'} ${skill.name} from shared pack`}
                  >
                    Share
                  </Checkbox>
                  <Checkbox
                    isSelected={skill.enabled === true}
                    isDisabled={skill.enabled !== true && enabledCount >= MAX_ENABLED}
                    onChange={(checked) => void toggle(skill, checked)}
                    className="min-h-11"
                    aria-label={`Switch ${skill.name} on`}
                  >
                    On
                  </Checkbox>
                  <Button isIconOnly size="sm" variant="ghost" className="min-h-11 min-w-11 text-muted" aria-label={`Edit skill ${skill.name}`} title="Edit skill" onPress={() => startEditing(skill)}>
                    <EditIcon size={16} />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" className="min-h-11 min-w-11 text-muted" aria-label={`Delete skill ${skill.name}`} title="Delete skill" onPress={() => void remove(skill)}>
                    <DeleteIcon size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
