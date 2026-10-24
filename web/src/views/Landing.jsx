import GoogleSignIn from '../components/GoogleSignIn.jsx';
import PlanCard from '../components/PlanCard.jsx';
import { CardIcon, ChartIcon, CheckIcon, DeviceIcon, ShieldIcon } from '../components/Icons.jsx';

const POINTS = [
  'One account for the desktop app and the web dashboard.',
  'Plans priced in Naira and paid through Paystack.',
  'Token usage and rate limits you can see before they bite.',
];

const FEATURES = [
  {
    icon: <DeviceIcon />,
    title: 'One account, every device',
    body: 'Sign in once and the desktop assistant and this dashboard share the same quota and history.',
  },
  {
    icon: <CardIcon />,
    title: 'Naira plans, Paystack checkout',
    body: 'Free, Starter, Pro or Power. Pay in Naira and move up a plan the moment you need more room.',
  },
  {
    icon: <ChartIcon />,
    title: 'Usage you can watch',
    body: 'See tokens used, tokens left and the request limits for your plan, all on one screen.',
  },
];

/** Signed-out marketing page: promise, then the sign-in card, then plans. */
export default function Landing({ plans, theme, busy, onCredential, onError, onChoose, onSignIn }) {
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Cloud dashboard</span>
          <h1>Your AI command centre, in the cloud.</h1>
          <p className="hero-lead">
            Zuri Cloud holds your assistant account, your usage and your billing. Sign in with Google,
            choose a plan in Naira, and pick up the same work on the desktop app or any browser.
          </p>
          <ul className="hero-points">
            {POINTS.map((point) => (
              <li key={point}>
                <CheckIcon />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="signin-card" id="signin-card">
          <h2>Sign in to Zuri Cloud</h2>
          <p>Use any verified Google account, including company and school accounts.</p>
          <GoogleSignIn theme={theme} onCredential={onCredential} onError={onError} />
          <div className="signin-foot">
            <ShieldIcon />
            <span>The free plan includes 100,000 tokens every month.</span>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-head">
          <h2>Everything account, nothing in the way</h2>
          <p>
            The dashboard is small on purpose. It answers three questions: what plan am I on, how much
            have I used, and what have I paid.
          </p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article className="card feature" key={feature.title}>
              <span className="feature-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="section-head">
          <h2>Plans in Naira</h2>
          <p>Every plan renews monthly. Tokens reset at the start of each billing period.</p>
        </div>
        {plans.length === 0 ? (
          <p className="empty">Plans could not be loaded. Reload the page to try again.</p>
        ) : (
          <div className="plan-grid">
            {plans.map((plan) => (
              <PlanCard
                key={plan.code}
                plan={plan}
                currentPlan={null}
                signedIn={false}
                busy={busy === plan.code}
                onChoose={onChoose}
                onSignIn={onSignIn}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="foot">
        <span>Zuri Cloud, the online half of the Zuri desktop app.</span>
        <span>Payments by Paystack. Prices in Naira.</span>
      </footer>
    </main>
  );
}
