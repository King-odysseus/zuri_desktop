import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, Textarea } from './ui.jsx';
import { DeleteIcon, EditIcon } from './Icons.jsx';

// Mirrors SKILL_MAX_ENABLED in src/main/store.js, which is the rule that is enforced;
// this copy only lets the page explain the limit before a switch is refused.
const MAX_ENABLED = 5;

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

  const zuriSkills = typeof window !== 'undefined' ? window.zuri?.skills : undefined;

  async function reload() {
    if (!zuriSkills) {
      // Running in a browser preview, outside Electron: there is no store to read.
      setStatus('error');
      return;
    }
    const result = await zuriSkills.list();
    if (result?.ok) {
      setSkills(Array.isArray(result.data) ? result.data : []);
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
    setEditingId('');
    setName('');
    setInstructions('');
  }

  /** Put a saved skill's text in the form so it can be corrected and saved again. */
  function startEditing(skill) {
    setProblem('');
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

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header className="mb-6">
          <h1 className="text-3xl font-medium tracking-tight">Skills</h1>
          <p className="mt-2 text-sm text-muted">
            Saved instructions Zuri follows while they are on. Up to {MAX_ENABLED} can be on at once, because each one is added to every message you send.
          </p>
        </header>

        {status === 'error' && <p role="alert" className="mb-4 text-sm text-danger">Skills need the Zuri desktop app.</p>}
        {problem !== '' && <p role="alert" className="mb-4 text-sm text-danger">{problem}</p>}

        <section className="rounded-xl border border-border bg-surface p-5">
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
              {editingId !== '' && (
                <Button type="button" variant="ghost" className="min-h-11" onPress={resetForm}>Cancel</Button>
              )}
              {editingId === '' && STARTER_IDEAS.map((idea) => (
                <Button
                  key={idea.name}
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-xs"
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

        <section className="mt-6 flex flex-col gap-3" aria-label="Your skills">
          {status === 'ready' && skills.length === 0 && <p className="text-sm text-muted">No skills yet. Save one above and switch it on.</p>}
          {skills.map((skill) => (
            <article key={skill.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface p-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{skill.name}</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{skill.instructions}</p>
              </div>
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
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
