import { formatNaira, formatTokens, planFeatures } from '../lib/format.js';
import { Button, Chip } from './ui.jsx';

/**
 * One pricing tile. The current plan shows a disabled badge, every other plan
 * starts a Paystack checkout, and a visitor without a session is asked to sign
 * in before choosing.
 *
 * `imageLines` is optional: an empty list (the default) renders exactly the tile
 * this has always rendered, and the image sentences sit in their own block after
 * the token bullets so the two allowances are never read as one list.
 */
export default function PlanCard({
  plan,
  currentPlan,
  signedIn,
  busy,
  onChoose,
  onSignIn,
  imageLines = [],
  admin = false,
}) {
  const isCurrent = plan.code === currentPlan;
  const images = Array.isArray(imageLines) ? imageLines : [];

  let action = null;
  if (isCurrent) {
    action = (
      <Button variant="secondary" disabled>
        Your plan
      </Button>
    );
  } else if (!signedIn) {
    action = <Button onClick={onSignIn}>Sign in to choose</Button>;
  } else if (admin) {
    // An administrator never pays, so the tile offers no checkout at all rather
    // than a button the server would refuse.
    action = <Button disabled>No payment needed</Button>;
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
        {formatNaira(plan.amountKobo)}
        <span> / month</span>
      </p>
      <p className="plan-tokens">{formatTokens(plan.monthlyTokens)} tokens each month</p>
      <ul className="plan-list">
        {planFeatures(plan.code).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {images.length > 0 && (
        <div className="plan-images">
          <p className="plan-images-title">Images</p>
          <ul className="plan-images-list">
            {images.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {action}
    </article>
  );
}
