import { formatNaira, formatTokens, planFeatures } from '../lib/format.js';
import { Button, Chip } from './ui.jsx';

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
      <Button variant="secondary" disabled>
        Your plan
      </Button>
    );
  } else if (plan.code === 'free') {
    action = <p className="stat-meta">Contact support to move back to Free.</p>;
  } else if (!signedIn) {
    action = <Button onClick={onSignIn}>Sign in to choose</Button>;
  } else {
    action = (
      <Button disabled={busy} onClick={() => onChoose(plan.code)}>
        {busy ? 'Opening checkout...' : 'Choose plan'}
      </Button>
    );
  }

  return (
    <article className={`plan-card${isCurrent ? ' is-current' : ''}`}>
      <div className="plan-top">
        <span className="plan-name">{plan.name}</span>
        {isCurrent && <Chip>Current plan</Chip>}
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
