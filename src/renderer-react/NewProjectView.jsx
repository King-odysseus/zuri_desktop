import { useState } from 'react';
import { Button, Input, Textarea } from './ui.jsx';
import { PROJECT_ICON_CHOICES } from './projectIcons.js';

// "Keep one topic in one place": a project is a named folder for chats. Naming it
// and picking an icon is the first job; the instructions are what make it useful,
// because Zuri follows them in every chat filed under the project.
// With a `project` this edits that project instead of creating a new one.
export default function NewProjectView({ project = null, onCreated }) {
  const editing = project !== null;
  const [name, setName] = useState(project?.name ?? '');
  const [icon, setIcon] = useState(project?.icon ?? PROJECT_ICON_CHOICES[0].key);
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveProject(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || saving) return;
    const call = editing ? window.zuri?.projects?.update : window.zuri?.projects?.create;
    if (!call) {
      setProblem('Projects need the Zuri desktop app.');
      return;
    }
    setSaving(true);
    setProblem('');
    const result = await call({ ...(editing ? { projectId: project.id } : {}), name: trimmed, icon, instructions });
    setSaving(false);
    if (!result?.ok) {
      setProblem(result?.error?.message ?? 'The project could not be saved.');
      return;
    }
    onCreated(result.data);
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        {/* The form sits in a plain wrapper on purpose: the shared page style gives a form that is a
            direct child of the page a card border and right-aligned content, which pushed this
            screen's heading and icons to one side of a boxed column. */}
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <form onSubmit={saveProject} className="flex flex-col items-center gap-6 text-center">
          <header>
            <h1 className="text-3xl font-medium tracking-tight">{editing ? 'Edit project' : 'New project'}</h1>
            <p className="mt-2 text-sm text-muted">Keep one topic in one place</p>
          </header>

          <div role="radiogroup" aria-label="Project icon" className="flex flex-wrap justify-center gap-2">
            {PROJECT_ICON_CHOICES.map(({ key, label, Icon }) => (
              <Button
                key={key}
                isIconOnly
                variant="ghost"
                role="radio"
                aria-checked={icon === key}
                aria-label={label}
                title={label}
                className={`min-h-11 min-w-11 rounded-xl ${icon === key ? 'zuri-selected-pill' : 'text-muted'}`}
                onPress={() => setIcon(key)}
              >
                <Icon size={20} />
              </Button>
            ))}
          </div>

          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Give it a name"
            aria-label="Project name"
            maxLength={40}
            autoFocus
            fullWidth
          />

          <Textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Instructions for this project (optional). For example: answer as a patient maths tutor."
            aria-label="Project instructions"
            maxLength={1000}
            rows={4}
            className="w-full text-left"
          />

          {problem !== '' && <p role="alert" className="text-sm text-danger">{problem}</p>}

          <Button type="submit" variant="primary" className="min-h-11 w-full" isDisabled={name.trim() === '' || saving}>
            {editing ? 'Save project' : 'Create project'}
          </Button>
        </form>
        </div>
      </div>
    </main>
  );
}
