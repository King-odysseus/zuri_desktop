/**
 * notableActions.js - the one description of a "something was created" card.
 *
 * When Zuri makes a to-do, a reminder or an automation, the answer is worth more
 * than a sentence: the person wants to see what was set up, when it fires, and the
 * way back to it. ChatGPT shows that as a coloured confirmation card, and both Zuri
 * apps show the same thing so a card looks identical in the app and the browser.
 *
 * Why this lives here rather than in either app: web/src/views/ChatView.jsx already
 * imports from this folder, so one module serves both without a build step. The
 * desktop's tool loop and the browser's tool loop each hand a tool result to
 * describeNotable() and paint whatever comes back, so the wording cannot drift.
 *
 * Every function is total: a malformed record answers null or '' rather than
 * throwing, because this runs while a reply is arriving and must never break it.
 */

/** The tool names that create something worth a card, and the kind each one makes. */
export const NOTABLE_TOOLS = {
  createTask: 'task',
  createReminder: 'reminder',
  createAutomation: 'automation',
};

/** The kind a tool name creates, or '' for a tool that creates nothing to show. */
export function notableKindFor(toolName) {
  return typeof toolName === 'string' && Object.hasOwn(NOTABLE_TOOLS, toolName) ? NOTABLE_TOOLS[toolName] : '';
}

/** @param {unknown} value @returns {string} */
function words(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A cap that keeps a card readable even if the model wrote an essay as a title. */
function clip(value, limit) {
  const text = words(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

/**
 * A moment as a person reads it. The date and time are the device's own clock,
 * because a reminder set for 09:00 should say 09:00 where the person is.
 * @param {unknown} value ISO string, or anything else
 * @returns {string}
 */
function momentText(value) {
  const raw = words(value);
  if (raw === '') return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "every 30 minutes", "every day at 09:00", "once, on 3 Nov at 09:00". */
function repeatText(repeat, intervalMinutes, timeOfDay, dueAt) {
  const kind = words(repeat).toLowerCase();
  if (kind === 'interval') {
    const minutes = Math.round(Number(intervalMinutes));
    if (!Number.isFinite(minutes) || minutes <= 0) return 'repeating';
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (kind === 'daily') {
    const time = words(timeOfDay);
    return /^\d{1,2}:\d{2}$/.test(time) ? `Every day at ${time}` : 'Every day';
  }
  const when = momentText(dueAt);
  return when === '' ? 'Once' : `Once, on ${when}`;
}

/** The same sentence for an automation's cadence. */
function cadenceText(cadence) {
  const shape = cadence !== null && typeof cadence === 'object' ? cadence : {};
  const type = words(shape.type).toLowerCase();
  if (type === 'interval') {
    const minutes = Math.round(Number(shape.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) return 'On an interval';
    return minutes % 60 === 0 && minutes >= 60
      ? `Every ${minutes / 60} hour${minutes === 60 ? '' : 's'}`
      : `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (type === 'daily') {
    const time = words(shape.timeOfDay);
    return /^\d{1,2}:\d{2}$/.test(time) ? `Every day at ${time}` : 'Every day';
  }
  const at = momentText(shape.at);
  return at === '' ? 'Once' : `Once, on ${at}`;
}

/** A to-do's priority in the words the Tasks page uses, or '' for the ordinary one. */
function priorityText(priority) {
  const level = words(priority).toLowerCase();
  if (level === 'high') return 'High priority';
  if (level === 'low') return 'Low priority';
  return '';
}

/**
 * One card's worth of text, ready to paint.
 * @param {string} kind 'task', 'reminder' or 'automation'
 * @param {unknown} data the record the tool created
 * @returns {{ kind: string, tone: string, badge: string, title: string, lines: Array<{ label: string, value: string }>, action: string } | null}
 */
export function describeNotable(kind, data) {
  if (data === null || typeof data !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (data);

  if (kind === 'task') {
    const title = clip(record.title, 120);
    if (title === '') return null;
    const lines = [];
    const when = words(record.due);
    if (when !== '') lines.push({ label: 'Due', value: when });
    const level = priorityText(record.priority);
    if (level !== '') lines.push({ label: 'Priority', value: level });
    const notes = clip(record.notes, 200);
    if (notes !== '') lines.push({ label: 'Notes', value: notes });
    return {
      kind,
      tone: 'success',
      badge: 'Task created',
      title,
      lines,
      action: 'tasks',
    };
  }

  if (kind === 'reminder') {
    const title = clip(record.title, 120);
    if (title === '') return null;
    return {
      kind,
      tone: 'success',
      badge: 'Reminder set',
      title,
      lines: [
        { label: 'When', value: momentText(record.dueAt) },
        { label: 'Repeats', value: repeatText(record.repeat, record.intervalMinutes, record.timeOfDay, record.dueAt) },
      ].filter((line) => line.value !== ''),
      action: 'reminders',
    };
  }

  if (kind === 'automation') {
    // An automation has no name of its own: the prompt is what the person will
    // recognise, so it becomes the title and the schedule sits under it.
    const prompt = clip(record.prompt, 140);
    if (prompt === '') return null;
    const lines = [{ label: 'Runs', value: cadenceText(record.cadence) }];
    const next = momentText(record.nextRunAt);
    if (next !== '') lines.push({ label: 'Next run', value: next });
    const mode = words(record.mode).toLowerCase();
    if (mode !== '' && mode !== 'ask') lines.push({ label: 'Mode', value: mode === 'act' ? 'Act' : mode === 'autopilot' ? 'Autopilot' : mode });
    return {
      kind,
      tone: 'success',
      badge: 'Automation created',
      title: prompt,
      lines,
      action: 'automations',
    };
  }

  return null;
}
