import { formatNaira, formatTokens, planFeatures } from '../lib/format.js';

/**
 * One pricing tile. The current plan shows a disabled badge, the free plan
 * points at support, and everything else starts a Paystack checkout - or asks
 * the visitor to sign in first when there is no session.
 */
export default function PlanCard({ plan, currentPlan, signedIn, busy, onChoose, onSignIn }) {
  const isCurrent = plan.code === currentPlan;

  let action = null;
  if (isCurrent) {
    action = (
      <button type="button" className="btn btn-secondary" disabled>
        Your plan
      </button>
    );
  } else if (plan.code === 'free') {
    action = <p className="stat-meta">Contact support to move back to Free.</p>;
  } else if (!signedIn) {
    action = (
      <button type="button" className="btn btn-primary" onClick={onSignIn}>
        Sign in to choose
      </button>
    );
  } else {
    action = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => onChoose(plan.code)}
      >
        {busy ? 'Opening checkout...' : 'Choose plan'}
      </button>
    );
  }

  return (
    <article className={`plan-card${isCurrent ? ' is-current' : ''}`}>
      <div className="plan-top">
        <span className="plan-name">{plan.name}</span>
        {isCurrent && <span className="chip">Current plan</span>}
      </div>
      <p className="plan-price">
        {plan.amountKobo === 0 ? 'Free' : formatNaira(plan.amountKobo)}
        {plan.amountKobo > 0 && <span> / month</span>}
      </p>
      <p className="plan-tokens">{formatTokens(plan.monthlyTokens)} tokens each month</p>
      <ul className="plan-list">
        {planFeatures(plan.code).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {action}
    </article>
  );
}
