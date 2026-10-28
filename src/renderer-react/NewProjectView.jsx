import { useState } from 'react';
import { Button, Input } from './ui.jsx';
import { PROJECT_ICON_CHOICES } from './projectIcons.js';

// "Keep one topic in one place": a project is a named folder for chats. Naming it
// and picking an icon is the whole job; chats are moved in from the sidebar.
export default function NewProjectView({ onCreated }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(PROJECT_ICON_CHOICES[0].key);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  async function createProject(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || saving) return;
    if (!window.zuri?.projects?.create) {
      setProblem('Projects need the Zuri desktop app.');
      return;
    }
    setSaving(true);
    setProblem('');
    const result = await window.zuri.projects.create({ name: trimmed, icon });
    setSaving(false);
    if (!result?.ok) {
      setProblem(result?.error?.message ?? 'The project could not be created.');
      return;
    }
    onCreated(result.data);
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <form onSubmit={createProject} className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-6 text-center">
          <header>
            <h1 className="text-3xl font-medium tracking-tight">New project</h1>
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

          {problem !== '' && <p role="alert" className="text-sm text-danger">{problem}</p>}

          <Button type="submit" variant="primary" className="min-h-11 w-full" isDisabled={name.trim() === '' || saving}>
            Create project
          </Button>
        </form>
      </div>
    </main>
  );
}
