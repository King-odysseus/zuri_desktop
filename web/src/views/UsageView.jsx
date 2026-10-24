import { Alert, DataRow, ProgressBar } from '../components/DataRow.jsx';
import { formatTokens } from '../lib/format.js';

/** Allowance and the guardrails the server enforces for this plan. */
export default function UsageView({ usage, limits }) {
  const planLimits = limits?.limits ?? {};

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Usage and limits</h1>
          <p>Counted over the current billing period. The desktop app reads the same numbers.</p>
        </div>
      </div>

      {usage.overQuota && (
        <Alert tone="danger">
          Allowance exhausted. Move to a bigger plan or wait for the next billing period.
        </Alert>
      )}
      {!usage.overQuota && usage.nearLimit && <Alert>Nearly at the limit for this period.</Alert>}

      <article className="card">
        <p className="stat-label">Tokens used</p>
        <p className="stat-value">
          {formatTokens(usage.usedTokens)} of {formatTokens(usage.monthlyTokens)} tokens
        </p>
        <ProgressBar percent={usage.percentUsed} warn={usage.nearLimit || usage.overQuota} />
        <p className="stat-meta">{usage.percentUsed}% of this period's allowance used.</p>
      </article>

      <div className="stat-grid">
        <article className="card">
          <p className="stat-label">Remaining tokens</p>
          <p className="stat-value">{formatTokens(usage.remainingTokens)}</p>
          <p className="stat-meta">Resets when the billing period renews.</p>
        </article>
        <article className="card">
          <p className="stat-label">Percent used</p>
          <p className="stat-value">{usage.percentUsed}%</p>
          <p className="stat-meta">Calculated from the tokens on your plan.</p>
        </article>
      </div>

      <article className="card">
        <p className="stat-label">Request limits for your plan</p>
        <div className="row-list" style={{ marginTop: 8 }}>
          <DataRow label="Requests per minute">{formatTokens(planLimits.requestsPerMinute)}</DataRow>
          <DataRow label="Requests at the same time">{formatTokens(planLimits.maxConcurrent)}</DataRow>
          <DataRow label="Largest input">{formatTokens(planLimits.maxInputTokens)} tokens</DataRow>
          <DataRow label="Largest reply">{formatTokens(planLimits.maxOutputTokens)} tokens</DataRow>
        </div>
      </article>
    </section>
  );
}
