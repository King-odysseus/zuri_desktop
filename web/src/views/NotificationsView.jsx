import { useEffect, useState } from 'react';
import { BellIcon } from '../components/Icons.jsx';
import { InlineAlert } from '../components/ui.jsx';
import { listNotifications, markNotificationsRead } from '../lib/api.js';

function dateLabel(value) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function NotificationsView() {
  const [state, setState] = useState({ status: 'loading', items: [], error: '' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await listNotifications();
        if (!active) return;
        setState({ status: 'ready', items: result.items, error: '' });
        await markNotificationsRead();
      } catch (error) {
        if (active) setState({ status: 'error', items: [], error: error?.message || 'Notifications could not be loaded.' });
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <section className="view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>Notifications</h1>
          <p className="view-subtitle">Updates saved while your apps were closed.</p>
        </div>
        <BellIcon aria-hidden="true" />
      </div>
      {state.status === 'loading' && <p className="project-loading">Loading notifications...</p>}
      {state.status === 'error' && <InlineAlert tone="danger">{state.error}</InlineAlert>}
      {state.status === 'ready' && state.items.length === 0 && (
        <div className="reminder-empty"><p className="reminder-empty-title">No notifications yet</p><p className="reminder-empty-note">Scheduled reminders and automation results will appear here.</p></div>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="reminder-list">
          {state.items.map((item) => (
            <li key={item.id} className="reminder-row">
              <span className="reminder-row-body">
                <span className="reminder-row-title">{item.title}</span>
                <span className="reminder-row-meta">{item.body}</span>
                <span className="reminder-row-date">{dateLabel(item.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
