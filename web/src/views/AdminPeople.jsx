import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/DataRow.jsx';
import { changeAdminUser, createAdminUser, fetchAdminStats, fetchAdminUsers } from '../lib/api.js';
import { formatNaira, formatTokens } from '../lib/format.js';

/** "3h", "2d" and so on, for when someone last used Zuri. */
function since(iso) {
  if (!iso) return 'never';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function uptime(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

/** A small bar per day, scaled to the busiest day, so a quiet week is visible at a glance. */
function DailyBars({ daily }) {
  const peak = Math.max(1, ...daily.map((day) => day.requests));
  return (
    <div className="admin-scroll">
      <div role="img" aria-label="Requests per day" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72, minWidth: daily.length * 7 }}>
        {daily.map((day) => (
          <span
            key={day.day}
            title={`${day.day}: ${day.requests} requests, ${day.people} people`}
            style={{ flex: 1, minWidth: 4, height: `${Math.max(4, (day.requests / peak) * 100)}%`, background: 'currentColor', opacity: day.requests ? 0.75 : 0.2, borderRadius: 2 }}
          />
        ))}
      </div>
    </div>
  );
}

/** A password the administrator must copy now: the server keeps only its hash. */
function PasswordNotice({ notice, onDismiss }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(notice.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Alert>
      <strong>{notice.heading}</strong>
      <span style={{ display: 'block', margin: '6px 0' }}>
        Email <code>{notice.email}</code> and temporary password <code>{notice.password}</code>. It is shown once; Zuri keeps only a scrambled copy.
      </span>
      <span className="card-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy login details'}</button>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>Done</button>
      </span>
    </Alert>
  );
}

/**
 * How the app is doing and who may use it: health numbers, the account list, and
 * the controls to add, suspend, restore, re-plan or reset a person.
 * @param {{ days: number, plans: Array<{ code: string, name: string }> }} props
 */
export default function AdminPeople({ days, plans }) {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ email: '', displayName: '', planCode: 'starter', days: 30 });
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchAdminStats(days));
    } catch (failure) {
      setError(failure.message);
    }
  }, [days]);

  const loadUsers = useCallback(async () => {
    try {
      setUsers((await fetchAdminUsers(search.trim())).users);
    } catch (failure) {
      setError(failure.message);
    }
  }, [search]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => {
    const timer = setTimeout(() => void loadUsers(), 250);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  async function run(work) {
    setBusy(true);
    setError('');
    try {
      await work();
      await Promise.all([loadUsers(), loadStats()]);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function addUser(event) {
    event.preventDefault();
    void run(async () => {
      const created = await createAdminUser({ ...form, days: Number(form.days) });
      setNotice({ heading: 'Account created.', email: created.user.email, password: created.temporaryPassword });
      setForm({ ...form, email: '', displayName: '' });
    });
  }

  function act(user, change, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    void run(async () => {
      const result = await changeAdminUser(user.id, change);
      if (change.action === 'reset-password') setNotice({ heading: 'Password reset. They were signed out everywhere.', email: user.email, password: result.temporaryPassword });
    });
  }

  function changePlan(user) {
    const planCode = window.prompt(`Plan for ${user.email} (${plans.map((plan) => plan.code).join(', ')})`, user.planCode || 'starter');
    if (!planCode) return;
    const length = window.prompt('For how many days?', '30');
    if (!length) return;
    act(user, { action: 'set-plan', planCode: planCode.trim(), days: Number(length) });
  }

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}

      {stats && (
        <>
          <div className="stat-grid">
            <article className="card">
              <p className="stat-label">People</p>
              <p className="stat-value">{stats.accounts.active}</p>
              <p className="stat-meta">{stats.accounts.seenToday} seen today, {stats.accounts.joined} joined, {stats.accounts.suspended} suspended.</p>
            </article>
            <article className="card">
              <p className="stat-label">Requests today</p>
              <p className="stat-value">{formatTokens(stats.usage.requestsToday)}</p>
              <p className="stat-meta">{formatTokens(stats.usage.tokensToday)} tokens today; {formatTokens(stats.usage.requests)} requests from {stats.usage.people} people this period.</p>
            </article>
            <article className="card">
              <p className="stat-label">Paying plans</p>
              <p className="stat-value">{stats.subscriptions.paying}</p>
              <p className="stat-meta">{formatNaira(stats.subscriptions.monthlyKobo)} a month. Payments: {stats.payments.paid} paid, {stats.payments.failed} failed.</p>
            </article>
            <article className="card">
              <p className="stat-label">Server</p>
              <p className="stat-value">{stats.server.databaseMs} ms</p>
              <p className="stat-meta">Database answer time. Up {uptime(stats.server.uptimeSeconds)}, {stats.server.environment}, Node {stats.server.nodeVersion}.</p>
            </article>
          </div>
          <article className="card">
            <p className="stat-label">Requests per day</p>
            <DailyBars daily={stats.daily} />
            {stats.topUsers.length > 0 && (
              <p className="stat-meta">Busiest: {stats.topUsers.map((top) => `${top.displayName || top.email} (${formatTokens(top.requests)})`).join(', ')}.</p>
            )}
          </article>
        </>
      )}

      {notice && <PasswordNotice notice={notice} onDismiss={() => setNotice(null)} />}

      <form className="card form-stack admin-form" onSubmit={addUser}>
        <p className="stat-label">Add a person</p>
        <div className="admin-fields">
          <label className="field"><span>Name</span>
            <input value={form.displayName} maxLength={60} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          </label>
          <label className="field"><span>Email</span>
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label className="field"><span>Plan</span>
            <select value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value })}>
              {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Days active</span>
            <input type="number" min="1" max="366" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </label>
        </div>
        <div className="card-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Working' : 'Create account'}</button>
        </div>
        <p className="stat-meta">The plan is active straight away with no payment step. A temporary password is generated for you to pass on.</p>
      </form>

      <article className="card">
        <div className="admin-head">
          <p className="stat-label">Accounts</p>
          <label className="field admin-window">
            <span className="sr-only">Search accounts</span>
            <input type="search" placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Plan</th>
                <th>Used</th>
                <th>Last seen</th>
                <th>Status</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={user.status === 'active' ? '' : 'is-off'}>
                  <td>{user.displayName || user.email}<small>{user.displayName ? user.email : ''}{user.isAdmin ? ' (admin)' : ''}</small></td>
                  <td>{user.planName || 'none'}<small>{user.subscriptionStatus}{user.periodEnd ? ` until ${user.periodEnd.slice(0, 10)}` : ''}</small></td>
                  <td>{formatTokens(user.usedTokens)}<small>of {formatTokens(user.monthlyTokens)}</small></td>
                  <td>{since(user.lastSeenAt)}</td>
                  <td>{user.status}</td>
                  <td>
                    {!user.isAdmin && (
                      <span className="card-actions">
                        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => changePlan(user)}>Plan</button>
                        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(user, { action: 'reset-password' }, `Reset the password for ${user.email}? They will be signed out everywhere.`)}>Reset</button>
                        {user.status === 'suspended' ? (
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(user, { action: 'restore' })}>Restore</button>
                        ) : (
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(user, { action: 'suspend' }, `Suspend ${user.email}? They are signed out and cannot sign in until restored.`)}>Suspend</button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={6}>No accounts match.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
