import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Input } from '@heroui/react';
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
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('ask');
  const [cadenceType, setCadenceType] = useState('daily');
  const [onceAt, setOnceAt] = useState(defaultDateTime);
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [agentId, setAgentId] = useState('');
  const [allowedTools, setAllowedTools] = useState([]);

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
        setMessage(result?.error?.message ?? 'schedules.json could not be read.');
        return;
      }
      setAutomations(Array.isArray(result.data?.automations) ? result.data.automations : []);
      setRuns(Array.isArray(result.data?.runs) ? result.data.runs : []);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error?.message ?? 'schedules.json could not be read.');
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
    setMessage('Editing this automation. Save changes or cancel.');
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
    const payload = { prompt: trimmedPrompt, mode, cadence: cadencePayload(), agentId, allowedTools };
    const result = wasEditing
      ? await automationsApi.update({ id: editingId, ...payload })
      : await automationsApi.create(payload);
    if (!result?.ok) {
      setMessage(result?.error?.message ?? 'The automation was not saved.');
      return;
    }
    resetForm();
    setMessage(wasEditing ? 'Changes saved to schedules.json.' : 'Automation saved to schedules.json.');
    await reload();
  }

  async function remove(automation) {
    if (typeof automationsApi?.delete !== 'function') return;
    const result = await automationsApi.delete({ id: automation.id });
    setMessage(result?.ok ? 'Automation deleted from schedules.json.' : result?.error?.message ?? 'The automation was not deleted.');
    if (result?.ok) await reload();
  }

  async function toggleEnabled(automation) {
    const result = await automationsApi?.update?.({ id: automation.id, enabled: automation.enabled === false });
    if (!result?.ok) setMessage(result?.error?.message ?? 'The automation could not be updated.');
    else await reload();
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="flex w-full min-w-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-3xl font-medium tracking-tight">Automations</h1>
          <p className="mt-2 text-sm text-muted">Schedule Zuri runs while the app is open, and catch up on the next start.</p>
        </header>

        <section className="mb-5 rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">{editing ? 'Edit automation' : 'New automation'}</h2>
              <p className="mt-1 text-sm text-muted">Saved to schedules.json.</p>
            </div>
            {editing && <Button variant="ghost" onPress={resetForm}>Cancel edit</Button>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium lg:col-span-2">
              What should it do
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={2000} placeholder="Summarise unread mail and list anything urgent" className="w-full resize-y rounded-medium border border-border bg-surface-secondary px-3 py-2 text-sm font-normal text-foreground outline-none placeholder:text-muted focus:border-primary" />
            </label>
            <SelectField label="Mode" value={mode} options={MODES} onChange={setMode} />
            <SelectField label="How often" value={cadenceType} options={CADENCES} onChange={setCadenceType} />
            {cadenceType === 'once' && <Input type="datetime-local" label="Date and time" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} />}
            {cadenceType === 'interval' && <Input type="number" min="1" step="1" label="Minutes between runs" value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} />}
            {cadenceType === 'daily' && <Input type="time" label="Time of day" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} />}
            <SelectField label="Agent" value={agentId} options={[{ value: '', label: 'Whoever is active' }, ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]} onChange={setAgentId} />
          </div>
          {tools.length > 0 && <div className="mt-4"><p className="mb-2 text-sm font-medium">Tools it may use</p><div className="grid gap-2 sm:grid-cols-2">{tools.map((tool) => <Checkbox key={tool.name} isSelected={allowedTools.includes(tool.name)} onChange={(checked) => setAllowedTools((current) => checked ? [...new Set([...current, tool.name])] : current.filter((name) => name !== tool.name))}>{tool.label}</Checkbox>)}</div></div>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span role="status" className="text-sm text-muted">{message}</span><Button variant="primary" onPress={() => void save()}>{editing ? 'Save changes' : 'Add automation'}</Button></div>
        </section>

        {status === 'loading' && <p className="text-sm text-muted">Loading schedules...</p>}
        {status === 'error' && <p className="text-sm text-danger">{message}</p>}
        {status === 'ready' && <section className="rounded-xl border border-border bg-surface p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-medium">Scheduled</h2><Chip size="sm">{automations.length}</Chip></div>{automations.length === 0 ? <p className="text-sm text-muted">No automations yet. The first one you add appears here.</p> : <ul className="flex flex-col gap-2">{automations.map((automation) => <li key={automation.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{automation.prompt}</p><p className="mt-1 text-xs text-muted">{describeCadence(automation.cadence)} - {describeNextRun(automation.nextRunAt)}</p></div><Chip size="sm" color={automation.enabled === false ? 'default' : 'primary'}>{automation.enabled === false ? 'Paused' : automation.mode ?? 'Ask'}</Chip><Checkbox aria-label={`Enable ${automation.prompt}`} isSelected={automation.enabled !== false} onChange={() => void toggleEnabled(automation)}>Enabled</Checkbox><Button size="sm" variant="ghost" onPress={() => startEdit(automation)}>Edit</Button><Button size="sm" variant="danger" onPress={() => void remove(automation)}>Delete</Button></li>)}</ul>}</section>}

        {status === 'ready' && runs.length > 0 && <section className="mt-5 rounded-xl border border-border bg-surface p-5"><h2 className="mb-3 text-lg font-medium">Recent runs</h2><ul className="flex flex-col gap-2">{runs.slice(0, 5).map((run) => <li key={run.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"><span className="truncate">{run.prompt ?? run.automationId ?? 'Automation run'}</span><Chip size="sm" color={run.status === 'failed' ? 'danger' : 'default'}>{run.status ?? 'unknown'}</Chip></li>)}</ul></section>}
      </div>
    </main>
  );
}
