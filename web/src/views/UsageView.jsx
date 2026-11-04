import { Alert, DataRow, ProgressBar } from '../components/DataRow.jsx';
import { Button } from '../components/ui.jsx';
import { formatNaira, formatTokens } from '../lib/format.js';

/** A local clock time, e.g. "14:35", or the empty string for a missing timestamp. */
function clockTime(value) {
  // A null resetsAt means the window is empty, and new Date(null) would be 1970,
  // so the missing value is rejected before the date is built.
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Allowance and the guardrails the server enforces for this plan.
 *
 * Two allowances are shown because the server counts two: the billing period's
 * tokens (`usage`) and the rolling 5-hour window inside it (`usage.window`). The
 * top-up packs arrive as props, so a server that sells none renders no shop.
 */
export default function UsageView({ usage, limits, topups = [], busyTopup = '', onTopUp }) {
  const planLimits = limits?.limits ?? {};
  const rolling = usage?.window ?? {};
  const packs = Array.isArray(topups) ? topups : [];
  const extraTokens = Math.max(0, Math.floor(Number(usage?.extraTokens) || 0));
  const rollingPercent = Math.round(Number(rolling.percentUsed) || 0);
  // The window ceiling is the plan burst allowance plus anything bought, so show
  // the difference rather than repeating the plan number back to the reader.
  const windowExtra = Math.max(0, Math.floor(Number(rolling.tokens) || 0) - Math.floor(Number(rolling.planTokens) || 0));
  const resetsAt = clockTime(rolling.resetsAt);

  return (
    <section className="view calm">
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

      <div className="calm-section">
        <h2>Tokens used</h2>
        <p className="calm-help" style={{ color: 'var(--text)', fontSize: 14 }}>
          {formatTokens(usage.usedTokens)} of {formatTokens(usage.monthlyTokens)} tokens
        </p>
        <ProgressBar percent={usage.percentUsed} warn={usage.nearLimit || usage.overQuota} />
        <p className="calm-help">{usage.percentUsed}% of this period's allowance used.</p>
        <div className="calm-lines">
          <DataRow label="Remaining tokens">{formatTokens(usage.remainingTokens)}</DataRow>
          <DataRow label="Percent used">{usage.percentUsed}%</DataRow>
          {extraTokens > 0 && <DataRow label="Extra tokens purchased">{formatTokens(extraTokens)}</DataRow>}
        </div>
        <p className="calm-help">
          Remaining tokens reset when the billing period renews. Percent used is calculated from the
          tokens on your plan.
          {extraTokens > 0
            ? ' Extra tokens are counted in the period allowance above, so they spend like plan tokens until they expire.'
            : ''}
        </p>
      </div>

      <div className="calm-section">
        <h2>Last 5 hours</h2>
        <p className="calm-help" style={{ color: 'var(--text)', fontSize: 14 }}>
          {Number(rolling.tokens) > 0
            ? `${formatTokens(rolling.usedTokens)} of ${formatTokens(rolling.tokens)} tokens`
            : `${formatTokens(rolling.usedTokens)} tokens in the last 5 hours`}
        </p>
        <ProgressBar percent={rollingPercent} warn={Boolean(rolling.overWindow)} />
        <p className="calm-help">
          {rollingPercent}% of the 5-hour allowance used.{' '}
          {resetsAt ? `Usage frees up again from ${resetsAt}.` : 'Nothing has been used in this window yet.'}
        </p>
        {windowExtra > 0 && (
          <p className="calm-help">
            Your purchased tokens raise this window too, so a pack can be spent straight away instead of
            waiting for older usage to age out.
          </p>
        )}
        <p className="calm-help">
          This rolling window protects the service from sudden bursts of traffic, and it refills on its
          own as older requests age out of the 5 hours.
        </p>
      </div>

      {packs.length > 0 && (
        <div className="calm-section">
          <h2>Buy extra usage</h2>
          <p className="calm-help">
            Tokens you buy are added to the current period's allowance. Each pack stays valid for the
            number of days shown on it.
          </p>
          <div className="calm-lines">
            {packs.map((pack) => {
              const busy = busyTopup === pack.code;
              const validDays = Math.max(0, Math.floor(Number(pack.validDays) || 0));
              // Built as one string so the comma never drifts away from the count.
              const validity = validDays > 0
                ? `, valid for ${validDays} ${validDays === 1 ? 'day' : 'days'}`
                : '';
              return (
                <div className="calm-line" key={pack.code} style={{ alignItems: 'center' }}>
                  <span>
                    {pack.name}
                    <span className="calm-sub">
                      {formatTokens(pack.tokens)} tokens{validity}
                    </span>
                  </span>
                  <span className="calm-value" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {formatNaira(pack.amountKobo)}
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      aria-label={`Buy ${pack.name}`}
                      onClick={() => onTopUp?.(pack.code)}
                    >
                      {busy ? 'Opening checkout...' : 'Buy'}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="calm-section">
        <h2>Request limits for your plan</h2>
        <div className="calm-lines">
          <DataRow label="Requests per minute">{formatTokens(planLimits.requestsPerMinute)}</DataRow>
          <DataRow label="Requests at the same time">{formatTokens(planLimits.maxConcurrent)}</DataRow>
          <DataRow label="Largest input">{formatTokens(planLimits.maxInputTokens)} tokens</DataRow>
          <DataRow label="Largest reply">{formatTokens(planLimits.maxOutputTokens)} tokens</DataRow>
        </div>
      </div>

      <div className="calm-section">
        <h2>How your allowance is counted</h2>
        <p className="calm-help">
          Each request counts input tokens plus output tokens. More expensive Zuri models have a higher
          weight, so they use more of the monthly allowance. Your subscription price is charged in Naira
          through Paystack; messages do not create a separate per-request charge.
        </p>
      </div>
    </section>
  );
}
