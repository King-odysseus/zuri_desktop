import Footer from '../components/Footer.jsx';
import HeroBackdrop from '../components/HeroBackdrop.jsx';
import PlanCard from '../components/PlanCard.jsx';
import { DOWNLOADS } from '../lib/downloads.js';
import {
  ArrowRightIcon,
  BoltIcon,
  BrainIcon,
  CardIcon,
  ChartIcon,
  CheckIcon,
  DeviceIcon,
  GlobeIcon,
  LogoMark,
  SparkIcon,
} from '../components/Icons.jsx';

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
  {
    icon: <BoltIcon />,
    title: 'Tasks, reminders, automations',
    body: 'Zuri keeps the small promises: a reminder that fires on time, a task that stays visible, a nightly research run.',
  },
  {
    icon: <BrainIcon />,
    title: 'Your answer style, remembered',
    body: 'Set length, tone and layout once. Every reply keeps that shape, across whichever model answers.',
  },
  {
    icon: <GlobeIcon />,
    title: 'Files in, documents out',
    body: 'Read a PDF or a sheet, then ask for a Word document, a workbook or a slide deck built from it.',
  },
];

const STATS = [
  { value: '100k', label: 'free tokens each month' },
  { value: '4', label: 'plans, priced in Naira' },
  { value: '5', label: 'model providers, one account' },
];

/**
 * Signed-out marketing page: promise, then how to start, then plans.
 * The sign-in form itself lives on /signin and /signup so the landing keeps one
 * job per screen.
 */
export default function Landing({ plans, theme, busy, onChoose, onNavigate }) {
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <SparkIcon />
            Zuri Cloud
          </span>
          <h1>
            Your AI command centre,
            <span className="hero-accent"> in the cloud.</span>
          </h1>
          <p className="hero-lead">
            Zuri Cloud holds your assistant account, your usage and your billing. Create an account with
            Google, choose a plan in Naira, and pick up the same work on the desktop app or any browser.
          </p>

          <div className="hero-cta">
            <button type="button" className="btn btn-primary" onClick={() => onNavigate('/signup')}>
              Create free account
              <ArrowRightIcon />
            </button>
            <button type="button" className="btn btn-outline" onClick={() => onNavigate('/signin')}>
              Sign in
            </button>
          </div>

          <ul className="hero-points">
            {POINTS.map((point) => (
              <li key={point}>
                <CheckIcon />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="hero-visual">
          {/* Decorative layers, back to front: the photo texture, the linked
              point globe, then drifting particles. All three are aria-hidden;
              the copy carries the meaning. */}
          <img
            className="hero-image"
            src="/img/hero-abstract.jpg"
            alt=""
            aria-hidden="true"
            decoding="async"
            width="1000"
            height="541"
          />
          <HeroBackdrop theme={theme} />
          <div className="hero-badge">
            <span className="hero-badge-mark">
              <LogoMark size={28} />
            </span>
            <span className="hero-badge-text">
              <strong>Zuri</strong>
              <span>Account, usage and billing in one place</span>
            </span>
          </div>
        </div>
      </section>

      <section className="stat-strip" aria-label="Zuri Cloud at a glance">
        {STATS.map((stat) => (
          <div className="stat-strip-item" key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </section>

      <section className="section" id="features">
        <div className="section-head">
          <h2>Everything account, nothing in the way</h2>
          <p>
            The dashboard is small on purpose. It answers three questions: what plan am I on, how much
            have I used, and what have I paid. The rest of Zuri is already on your desktop.
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

      <section className="section showcase" id="how">
        <div className="showcase-inner">
          <div className="showcase-copy">
            <h2>Start on the desktop, continue in the browser</h2>
            <p>
              Your plan, token meter and payment history follow the account, not the machine. Sign in
              anywhere and the numbers match.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => onNavigate('/signup')}>
              Create your account
              <ArrowRightIcon />
            </button>
          </div>
          <div className="showcase-visual">
            <img
              src="/img/hero-rays.jpg"
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              width="800"
              height="1200"
            />
            <div className="showcase-card">
              <span className="stat-label">This month</span>
              <span className="showcase-value">68% of plan used</span>
              <span className="bar" aria-hidden="true">
                <span className="bar-fill" style={{ width: '68%' }} />
              </span>
              <span className="stat-meta">Same figure on desktop, web and the next device.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section downloads" id="downloads">
        <div className="section-head">
          <h2>Get the Zuri desktop app</h2>
          <p>Install the Windows app to keep your assistant, files and automations close at hand.</p>
        </div>
        <div className="download-grid">
          {Object.values(DOWNLOADS).map((download) => (
            <a
              className={`download-card${download.available ? '' : ' is-unavailable'}`}
              href={download.href}
              target="_blank"
              rel="noreferrer"
              key={download.label}
            >
              <span className="download-card-copy">
                <strong>{download.label}</strong>
                <span>{download.detail}</span>
              </span>
              <span className="download-card-action">{download.available ? 'View release' : 'Watch releases'}</span>
            </a>
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
                onSignIn={() => onNavigate('/signin')}
              />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
