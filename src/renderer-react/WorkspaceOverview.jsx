import { useEffect, useState } from 'react';

/** How many tasks and reminders the two lists show before "and N more" would be needed. */
const LIST_LENGTH = 3;

/** The day of the month a due date falls on, or '-' when there is no usable date. */
function dayOf(value) {
  const when = typeof value === 'string' ? new Date(value) : null;
  return when !== null && !Number.isNaN(when.getTime()) ? String(when.getDate()) : '-';
}

/** "1 task" or "3 tasks", so a count never reads "1 tasks". */
function counted(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The cards above the first message: what is actually waiting for this person.
 *
 * Every figure is read from the same stores the Tasks, Reminders and Automations
 * pages use, and each card says plainly when there is nothing, so an empty account
 * never shows somebody else's example data as its own.
 */
export default function WorkspaceOverview() {
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [automations, setAutomations] = useState([]);

  useEffect(() => {
    const api = window.zuri;
    let active = true;

    const load = async () => {
      const [taskResult, reminderResult, automationResult] = await Promise.all([
        api?.tasks?.list?.(),
        api?.reminders?.list?.(),
        api?.automations?.list?.(),
      ]);
      if (!active) return;
      if (taskResult?.ok) setTasks(Array.isArray(taskResult.data) ? taskResult.data : []);
      if (reminderResult?.ok) setReminders(Array.isArray(reminderResult.data) ? reminderResult.data : []);
      if (automationResult?.ok) setAutomations(Array.isArray(automationResult.data?.automations) ? automationResult.data.automations : []);
    };

    // A task ticked off or a reminder added on another page changes these cards, so
    // they follow main's change events rather than going stale until the next launch.
    const stopListening = api?.state?.onChanged?.((change) => {
      if (['tasks', 'reminders', 'automations'].includes(change?.area)) void load();
    });
    void load();
    return () => {
      active = false;
      stopListening?.();
    };
  }, []);

  const openTasks = tasks.filter((task) => !task.done);
  const nextTasks = openTasks.slice(0, LIST_LENGTH);
  const nextReminders = reminders.slice(0, LIST_LENGTH);

  return (
    <div className="zuri-opening-dashboard" aria-label="Workspace overview">
      <div className="zuri-opening-activity">
        <div className="zuri-opening-card">
          <strong>{counted(openTasks.length, 'open task')}</strong>
          <span>{openTasks.length === 0 ? 'Nothing waiting' : 'Waiting on you'}</span>
        </div>
        <div className="zuri-opening-card">
          <strong>{counted(reminders.length, 'reminder')}</strong>
          <span>{reminders.length === 0 ? 'None coming up' : 'Still to come'}</span>
        </div>
        <div className="zuri-opening-card">
          <strong>{counted(automations.length, 'automation')}</strong>
          <span>{automations.length === 0 ? 'None set up' : 'Set to run on their own'}</span>
        </div>
      </div>
      <div className="zuri-opening-dashboard-grid">
        <section className="zuri-opening-card">
          <span className="zuri-opening-label">Next tasks</span>
          <div className="zuri-opening-calendar-list">
            {nextTasks.length === 0 && <span>No open tasks. Ask Zuri to turn something into one.</span>}
            {nextTasks.map((task) => (
              <div key={task.id} className="zuri-opening-calendar-item"><b>{dayOf(task.due)}</b><span>{task.title}</span></div>
            ))}
          </div>
        </section>
        <section className="zuri-opening-card">
          <span className="zuri-opening-label">Coming reminders</span>
          <div className="zuri-opening-calendar-list">
            {nextReminders.length === 0 && <span>No reminders. Ask Zuri to remind you of something.</span>}
            {nextReminders.map((reminder) => (
              <div key={reminder.id} className="zuri-opening-calendar-item"><b>{dayOf(reminder.dueAt)}</b><span>{reminder.title}</span></div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
