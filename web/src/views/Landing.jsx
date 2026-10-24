import Footer from '../components/Footer.jsx';
import PlanCard from '../components/PlanCard.jsx';
import { Button, Chip, UsageBar } from '../components/ui.jsx';
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
export default function Landing({ plans, busy, onChoose, onNavigate }) {
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
            <Button size="lg" onClick={() => onNavigate('/signup')}>
              Create free account
              <ArrowRightIcon />
            </Button>
            <Button size="lg" variant="outline" onClick={() => onNavigate('/signin')}>
              Sign in
            </Button>
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
          {/* A still of the dashboard rather than decoration: the same two
              figures a customer sees after signing in. The copy beside it
              carries the meaning, so the panel is hidden from assistive tech. */}
          <div className="preview" aria-hidden="true">
            <div className="preview-bar">
              <span className="preview-brand">
                <span className="preview-mark">
                  <LogoMark size={15} />
                </span>
                Zuri Cloud
              </span>
              <Chip>Overview</Chip>
            </div>
            <div className="preview-body">
              <div className="preview-usage">
                <span className="preview-label">This month</span>
                <span className="preview-value">68%</span>
                <span className="preview-sub">of the Pro plan used</span>
                <UsageBar percent={68} label="Pro plan used" />
              </div>
              <div className="preview-tiles">
                <div className="preview-tile">
                  <span>Tokens left</span>
                  <strong>32,000</strong>
                </div>
                <div className="preview-tile">
                  <span>Renews</span>
                  <strong>12 Nov</strong>
                </div>
              </div>
              <div className="preview-row">
                <span>Answer style</span>
                <strong>Balanced, neutral</strong>
              </div>
              <div className="preview-row">
                <span>Requests today</span>
                <strong>14 of 200</strong>
              </div>
            </div>
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
            <Button onClick={() => onNavigate('/signup')}>
              Create your account
              <ArrowRightIcon />
            </Button>
          </div>
          <div className="showcase-visual" aria-hidden="true">
            <div className="device-row">
              <div className="device-card">
                <span className="device-label">Desktop app</span>
                <strong className="device-value">68%</strong>
                <UsageBar percent={68} label="Desktop app" />
              </div>
              <div className="device-card">
                <span className="device-label">This browser</span>
                <strong className="device-value">68%</strong>
                <UsageBar percent={68} label="This browser" />
              </div>
            </div>
            <p className="device-note">Same figure on desktop, web and the next device.</p>
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
