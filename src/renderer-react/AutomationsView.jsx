import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, DateField, Input, Textarea } from './ui.jsx';
import SelectField from './SelectField.jsx';

const MODES = [
  { value: 'ask', label: 'Ask' },
  { value: 'act', label: 'Act' },
  { value: 'autopilot', label: 'Autopilot' },
];

const CADENCES = [
  { value: 'once', label: 'Once' },
  { value: 'interval', label: 'Every few minutes' },
  { value: 'daily', label: 'Every day' },
];

function defaultDateTime() {
  const date = new Date(Date.now() + 60 * 60_000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeCadence(cadence = {}) {
  if (cadence.type === 'interval') return `Every ${cadence.minutes ?? 60} minutes`;
  if (cadence.type === 'daily') return `Daily at ${cadence.timeOfDay ?? '09:00'}`;
  return cadence.at ? `Once at ${new Date(cadence.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Once';
}

function describeNextRun(value) {
  if (typeof value !== 'string') return 'No next run scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No next run scheduled' : `Next run ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function cloneAgentChoices(value) {
  return Array.isArray(value)
    ? value.filter((agent) => typeof agent?.id === 'string' && agent.id !== '').map((agent) => ({
        id: agent.id,
        name: typeof agent.name === 'string' && agent.name.trim() !== '' ? agent.name : agent.id,
      }))
    : [];
}

export default function AutomationsView() {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const automationsApi = api?.automations;
  const [automations, setAutomations] = useState([]);
  const [runs, setRuns] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tools, setTools] = useState([]);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState('');
  // The editor is a card that only exists while someone is adding or editing,
  // so the saved automations stay the page's main content.
  const [showEditor, setShowEditor] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('ask');
  const [cadenceType, setCadenceType] = useState('daily');
  const [onceAt, setOnceAt] = useState(defaultDateTime);
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [agentId, setAgentId] = useState('');
  const [allowedTools, setAllowedTools] = useState([]);
  const [dryRun, setDryRun] = useState(false);

  const editing = useMemo(
    () => automations.find((automation) => automation.id === editingId) ?? null,
    [automations, editingId],
  );

  async function reload() {
    if (typeof automationsApi?.list !== 'function') {
      setStatus('error');
      setMessage('Automation data is only available when this page runs inside the Zuri app.');
      return;
    }
    try {
      const result = await automationsApi.list();
      if (!result?.ok) {
        setStatus('error');
        setMessage(result?.error?.message ?? 'Your automations could not be loaded.');
        return;
      }
      setAutomations(Array.isArray(result.data?.automations) ? result.data.automations : []);
      setRuns(Array.isArray(result.data?.runs) ? result.data.runs : []);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error?.message ?? 'Your automations could not be loaded.');
    }
  }

  useEffect(() => {
    void reload();
    const unsubscribers = [];
    if (typeof api?.state?.onChanged === 'function') {
      unsubscribers.push(api.state.onChanged((change) => {
        if (change?.area === 'automations') void reload();
      }));
    }
    if (typeof api?.settings?.get === 'function') {
      void api.settings.get().then((result) => {
        if (result?.ok) setAgents(cloneAgentChoices(result.data?.agents));
      });
    }
    if (typeof api?.tools?.list === 'function') {
      void api.tools.list().then((result) => {
        if (result?.ok && Array.isArray(result.data)) {
          setTools(result.data.filter((tool) => typeof tool?.name === 'string').map((tool) => ({
            name: tool.name,
            label: String(tool.label ?? tool.name),
          })));
        }
      });
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    // The bridge is stable for the lifetime of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditingId('');
    setPrompt('');
    setMode('ask');
    setCadenceType('daily');
    setOnceAt(defaultDateTime());
    setIntervalMinutes('60');
    setTimeOfDay('09:00');
    setAgentId('');
    setAllowedTools([]);
    setDryRun(false);
  }

  function startEdit(automation) {
    const cadence = automation.cadence ?? {};
    setEditingId(automation.id);
    setPrompt(String(automation.prompt ?? ''));
    setMode(MODES.some((option) => option.value === automation.mode) ? automation.mode : 'ask');
    setCadenceType(CADENCES.some((option) => option.value === cadence.type) ? cadence.type : 'daily');
    if (cadence.type === 'once' && typeof cadence.at === 'string') {
      const date = new Date(cadence.at);
      if (!Number.isNaN(date.getTime())) {
        const pad = (value) => String(value).padStart(2, '0');
        setOnceAt(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`);
      }
    }
    setIntervalMinutes(String(cadence.minutes ?? 60));
    setTimeOfDay(String(cadence.timeOfDay ?? '09:00'));
    setAgentId(typeof automation.agentId === 'string' ? automation.agentId : '');
    setAllowedTools(Array.isArray(automation.allowedTools) ? automation.allowedTools : []);
    setDryRun(automation.dryRun === true);
    setMessage('Editing this automation. Save changes or cancel.');
  }

  function openCreate() {
    resetForm();
    setMessage('');
    setShowEditor(true);
  }

  function openEdit(automation) {
    startEdit(automation);
    setShowEditor(true);
  }

  function closeEditor() {
    resetForm();
    setShowEditor(false);
    setMessage('');
  }

  function cadencePayload() {
    if (cadenceType === 'once') return { type: 'once', at: new Date(onceAt).toISOString() };
    if (cadenceType === 'interval') return { type: 'interval', minutes: Number(intervalMinutes) };
    return { type: 'daily', timeOfDay };
  }

  async function save() {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === '') {
      setMessage('An automation needs a prompt to run.');
      return;
    }
    if (cadenceType === 'once' && Number.isNaN(new Date(onceAt).getTime())) {
      setMessage('Pick the date and time for the one-off run.');
      return;
    }
    if (cadenceType === 'interval' && (!Number.isFinite(Number(intervalMinutes)) || Number(intervalMinutes) < 1)) {
      setMessage('The gap between runs must be at least one minute.');
      return;
    }
    if (cadenceType === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
      setMessage('The daily time must be a 24-hour time such as 09:30.');
      return;
    }
    if (typeof automationsApi?.create !== 'function') {
      setMessage('Automation data is only available inside the Zuri app.');
      return;
    }
    const wasEditing = editingId !== '';
    setMessage(wasEditing ? 'Saving changes...' : 'Saving...');
    const payload = { prompt: trimmedPrompt, mode, cadence: cadencePayload(), agentId, allowedTools, dryRun };
    const result = wasEditing
      ? await automationsApi.update({ id: editingId, ...payload })
      : await automationsApi.create(payload);
    if (!result?.ok) {
      setMessage(result?.error?.message ?? 'The automation was not saved.');
      return;
    }
    resetForm();
    setShowEditor(false);
    setMessage(wasEditing ? 'Changes saved.' : 'Automation saved.');
    await reload();
  }

  async function remove(automation) {
    if (typeof automationsApi?.delete !== 'function') return;
    const result = await automationsApi.delete({ id: automation.id });
    if (!result?.ok) {
      setMessage(result?.error?.message ?? 'The automation was not deleted.');
      return;
    }
    // Deleting the automation being edited would leave the editor on a record
    // that no longer exists.
    if (editingId === automation.id) {
      resetForm();
      setShowEditor(false);
    }
    setMessage('Automation deleted.');
    await reload();
  }

  async function toggleEnabled(automation) {
    const result = await automationsApi?.update?.({ id: automation.id, enabled: automation.enabled === false });
    if (!result?.ok) setMessage(result?.error?.message ?? 'The automation could not be updated.');
    else await reload();
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Automations</h1>
            <p className="mt-2 text-sm text-muted">Runs Zuri does on a schedule while the app is open.</p>
          </div>
          {/* Hidden while the editor is open so the page keeps one primary action. */}
          {!showEditor && <Button variant="primary" className="shrink-0" onPress={openCreate}>New automation</Button>}
        </header>

        {status === 'loading' && <p className="text-sm text-muted">Loading automations...</p>}
        {status === 'error' && <p role="alert" className="zuri-notice is-danger text-sm text-danger">{message}</p>}

        {status === 'ready' && message !== '' && <p role="status" className="text-sm text-muted">{message}</p>}

        {/* The editor sits above the list: the person just pressed a button in
            the header, so the form must open where their eye already is. */}
        {showEditor && (
          <section className="border-b border-border pb-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-medium">{editing ? 'Edit automation' : 'New automation'}</h2>
              <Button variant="ghost" onPress={closeEditor}>Cancel</Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Textarea
                label="What should it do"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Summarise unread mail and list anything urgent"
                className="lg:col-span-2"
              />
              <SelectField label="Mode" value={mode} options={MODES} onChange={setMode} />
              <SelectField label="How often" value={cadenceType} options={CADENCES} onChange={setCadenceType} />
              {cadenceType === 'once' && (
                <>
                  <DateField label="Date" value={onceAt.slice(0, 10)} onChange={(date) => setOnceAt(`${date}T${onceAt.slice(11, 16)}`)} />
                  <Input type="time" label="Time" value={onceAt.slice(11, 16)} onChange={(event) => setOnceAt(`${onceAt.slice(0, 10)}T${event.target.value}`)} />
                </>
              )}
              {cadenceType === 'interval' && <Input type="number" min="1" step="1" label="Minutes between runs" value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} />}
              {cadenceType === 'daily' && <Input type="time" label="Time of day" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} />}
              <SelectField label="Agent" value={agentId} options={[{ value: '', label: 'Whoever is active' }, ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]} onChange={setAgentId} />
            </div>
            <div className="mt-4">
              <Checkbox isSelected={dryRun} onChange={setDryRun}>
                Preview only (do not change files)
              </Checkbox>
              <p className="mt-1 text-xs text-muted">The run will show the planned steps and save no output file.</p>
            </div>
            {tools.length > 0 && <div className="mt-4"><p className="mb-2 text-sm font-medium">Tools it may use</p><div className="grid gap-2 sm:grid-cols-2">{tools.map((tool) => <Checkbox key={tool.name} isSelected={allowedTools.includes(tool.name)} onChange={(checked) => setAllowedTools((current) => checked ? [...new Set([...current, tool.name])] : current.filter((name) => name !== tool.name))}>{tool.label}</Checkbox>)}</div></div>}
            <div className="mt-5 flex justify-end">
              <Button variant="primary" onPress={() => void save()}>{editing ? 'Save changes' : 'Add automation'}</Button>
            </div>
          </section>
        )}

        {status === 'ready' && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Scheduled</h2>
              <Chip size="sm">{automations.length}</Chip>
            </div>
            {automations.length === 0 ? (
              <div className="zuri-empty-state">
                <strong>No automations yet</strong>
                <p>Choose New automation to have Zuri run a prompt on a schedule.</p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {automations.map((automation) => (
                  <li key={automation.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{automation.prompt}</p>
                      <p className="mt-1 text-xs text-muted">{describeCadence(automation.cadence)} - {describeNextRun(automation.nextRunAt)}</p>
                    </div>
                    <Chip size="sm" color={automation.enabled === false ? 'warning' : 'primary'}>{automation.enabled === false ? 'Paused' : automation.dryRun === true ? 'Preview' : 'Enabled'}</Chip>
                    <Checkbox aria-label={`Enable ${automation.prompt}`} isSelected={automation.enabled !== false} onChange={() => void toggleEnabled(automation)}>Enabled</Checkbox>
                    <Button size="sm" variant="ghost" onPress={() => openEdit(automation)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="zuri-danger-quiet" onPress={() => void remove(automation)}>Delete</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {status === 'ready' && runs.length > 0 && <section><h2 className="mb-2 text-lg font-medium">Recent runs</h2><ul className="flex flex-col divide-y divide-border">{runs.slice(0, 5).map((run) => <li key={run.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate">{run.prompt ?? run.automationId ?? 'Automation run'}</span><Chip size="sm" color={run.status === 'failed' ? 'danger' : run.status === 'completed' ? 'success' : 'default'}>{run.status ?? 'unknown'}</Chip></li>)}</ul></section>}
        </div>
      </div>
    </main>
  );
}
