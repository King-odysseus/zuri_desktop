import { Alert, DataRow, ProgressBar } from '../components/DataRow.jsx';
import { formatDate, formatTokens } from '../lib/format.js';

/** First screen after sign-in: plan, allowance and who is signed in. */
export default function OverviewView({ me, usage }) {
  const user = me?.user ?? {};
  const subscription = me?.subscription ?? {};
  const name = user.displayName || user.email || 'Zuri user';
  const chipTone = usage.overQuota ? ' chip-danger' : usage.nearLimit ? ' chip-warning' : '';

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Welcome back, {(name.split(' ')[0] || 'friend').trim()}</h1>
          <p>Signed in as {user.email ?? 'your Google account'}</p>
        </div>
        <span className={`chip${chipTone}`}>{subscription.planName ?? 'Free'} plan</span>
      </div>

      {usage.overQuota && (
        <Alert tone="danger">
          You have used your whole monthly allowance. Requests will fail until the period renews or
          you move to a bigger plan.
        </Alert>
      )}
      {!usage.overQuota && usage.nearLimit && (
        <Alert>You are close to your monthly token allowance. Consider a bigger plan before you run out.</Alert>
      )}

      <div className="stat-grid">
        <article className="card">
          <p className="stat-label">Current plan</p>
          <p className="stat-value">{subscription.planName ?? 'Free'}</p>
          <p className="stat-meta">{formatTokens(usage.monthlyTokens)} tokens each month</p>
        </article>
        <article className="card">
          <p className="stat-label">Tokens this period</p>
          <p className="stat-value">
            {formatTokens(usage.usedTokens)} of {formatTokens(usage.monthlyTokens)}
          </p>
          <ProgressBar percent={usage.percentUsed} warn={usage.nearLimit || usage.overQuota} />
          <p className="stat-meta">
            {formatTokens(usage.remainingTokens)} tokens left ({usage.percentUsed}% used)
          </p>
        </article>
        <article className="card">
          <p className="stat-label">Billing period ends</p>
          <p className="stat-value">{formatDate(subscription.currentPeriodEnd)}</p>
          <p className="stat-meta">
            {subscription.currentPeriodStart
              ? `Started ${formatDate(subscription.currentPeriodStart)}`
              : 'Your plan renews every month'}
          </p>
        </article>
      </div>

      <article className="card">
        <p className="stat-label">Account</p>
        <div className="row-list" style={{ marginTop: 8 }}>
          <DataRow label="Name">{name}</DataRow>
          <DataRow label="Email">{user.email ?? 'Not set'}</DataRow>
          <DataRow label="Member since">{formatDate(user.createdAt)}</DataRow>
        </div>
      </article>
    </section>
  );
}
