import { useEffect, useState } from 'react';
import Footer from '../components/Footer.jsx';
import DownloadList from '../components/DownloadList.jsx';
import ImagePrices from '../components/ImagePrices.jsx';
import PlanCard from '../components/PlanCard.jsx';
import { Button, UsageBar } from '../components/ui.jsx';
import {
  ArrowRightIcon,
  BoltIcon,
  BrainIcon,
  CardIcon,
  ChartIcon,
  CheckIcon,
  DeviceIcon,
  GlobeIcon,
  FolderIcon,
  LogoMark,
  MessageIcon,
  SendIcon,
  SettingsIcon,
  SparkIcon,
  TaskIcon,
  BellIcon,
} from '../components/Icons.jsx';
import { fetchImagePrices } from '../lib/api.js';
import { planImageLines } from '../lib/format.js';

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
    body: 'Starter, Pro, Power or Max. Pay in Naira and move up a plan the moment you need more room.',
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
  { value: '2m', label: 'Starter tokens each month' },
  { value: '4', label: 'plans, priced in Naira' },
  { value: '6', label: 'Zuri models, one account' },
];

// The frame colour of the preview. The theme attribute, not a class, switches the
// site's dark mode, so the dark variant is written against [data-theme=dark].
const NAVY = 'bg-[#0b1f3a] [[data-theme=dark]_&]:bg-[#0a1226]';
const RAIL_ICONS = [MessageIcon, TaskIcon, BellIcon, FolderIcon, SettingsIcon];
const BAR_HEIGHTS = ['h-[40%]', 'h-[62%]', 'h-[48%]', 'h-[80%]', 'h-[58%]', 'h-[92%]'];
const PREVIEW_CARDS = [
  { title: 'Writing sprint', note: 'Brief in progress' },
  { title: 'Design review', note: '3 updates' },
  { title: 'Launch plan', note: 'On track' },
];
const CALENDAR_ROWS = [
  ['14', 'Creating app design'],
  ['19', 'Meeting with a client'],
];
const CARD = 'min-w-0 rounded-xl border border-hairline bg-surface shadow-sm';

/**
 * A still of the desktop app drawn with Tailwind utilities and the site's colour
 * tokens: the same rail, greeting and message box a customer sees after installing.
 * The copy beside it carries the meaning, so the panel is hidden from assistive tech.
 */
function AppPreview() {
  return (
    <div className="flex items-center justify-center py-2" aria-hidden="true">
      <div className="w-full overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl">
        <div className={`flex gap-1.5 px-4 py-3 ${NAVY}`}>
          <i className="size-2.5 rounded-full bg-white/30" />
          <i className="size-2.5 rounded-full bg-white/30" />
          <i className="size-2.5 rounded-full bg-white/30" />
        </div>
        <div className="grid grid-cols-[48px_minmax(0,1fr)]">
          <div className={`flex flex-col items-center gap-1.5 py-3 ${NAVY}`}>
            {RAIL_ICONS.map((Icon, index) => (
              <span
                key={index}
                className={`grid size-8 place-items-center rounded-full [&_svg]:size-4 ${index === 0 ? 'bg-accent-soft text-accent-hover' : 'text-white/70'}`}
              >
                <Icon />
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2 bg-canvas px-4 pb-4 pt-6">
            <LogoMark size={40} className="rounded-xl" />
            <strong className="text-xl font-medium tracking-tight text-body">Good morning, Tolu</strong>
            <span className="mb-1 text-xs text-muted">I can draft a reply for you to edit.</span>
            <div className="grid w-full gap-2 text-left sm:grid-cols-3">
              {PREVIEW_CARDS.map((card) => (
                <div key={card.title} className={`${CARD} grid gap-0.5 p-2.5`}>
                  <strong className="text-[11px] font-bold text-body">{card.title}</strong>
                  <span className="text-[10px] text-muted">{card.note}</span>
                </div>
              ))}
            </div>
            <div className="grid w-full gap-3 text-left sm:grid-cols-[0.9fr_1.1fr]">
              <div className={`${CARD} grid content-start gap-2.5 p-3.5`}>
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Project statistics</span>
                <div className="flex h-24 items-end gap-1.5 rounded-lg bg-surface-secondary px-2 pt-2.5">
                  {BAR_HEIGHTS.map((height, index) => (
                    <i key={index} className={`flex-1 rounded-t ${height} ${index % 2 === 0 ? 'bg-accent' : 'bg-accent/60'}`} />
                  ))}
                </div>
                <small className="text-[10px] text-muted">
                  <b className="text-success">On target</b> 12 tasks this week
                </small>
              </div>
              <div className={`${CARD} grid content-start gap-2.5 p-3.5`}>
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Project calendar</span>
                {CALENDAR_ROWS.map(([day, label]) => (
                  <div key={day} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2 border-t border-hairline pt-2.5">
                    <b className="text-[13px] text-accent-text">{day}</b>
                    <span className="text-[10px] text-muted">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1 flex w-full items-center justify-between rounded-full border border-control-border bg-surface py-1.5 pl-4 pr-1.5 text-[13px] text-muted">
              <span>Ask Zuri</span>
              <span className="grid size-[30px] place-items-center rounded-full bg-accent text-white [&_svg]:size-[15px]">
                <SendIcon />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Signed-out marketing page: promise, then how to start, then plans.
 * The sign-in form itself lives on /signin and /signup so the landing keeps one
 * job per screen.
 */
export default function Landing({ plans, busy, onChoose, onNavigate }) {
  const [imagePrices, setImagePrices] = useState([]);

  // The image catalogue is an extra, and fetchImagePrices never rejects: a
  // server without the endpoint leaves this empty and the section below is not
  // rendered at all, so the page a visitor sees is the one it always was. The
  // rest of the page does not wait for it.
  useEffect(() => {
    let cancelled = false;
    fetchImagePrices().then((prices) => {
      if (!cancelled) setImagePrices(prices);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
              Choose a paid plan
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

        <AppPreview />
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
          <p>Install Zuri on your computer to keep your assistant, files and automations close at hand. The download starts straight away.</p>
        </div>
        <DownloadList />
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
                imageLines={planImageLines(plan.code, imagePrices, plans)}
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

      {imagePrices.length > 0 && (
        <section className="section" id="images">
          <div className="section-head">
            <h2>Pictures, priced in Naira</h2>
            <p>
              Images are paid for out of the same monthly allowance as your messages, so a picture
              never adds a second line to your bill.
            </p>
          </div>
          <ImagePrices imagePrices={imagePrices} plans={plans} />
        </section>
      )}

      <section className="section pricing-notes" id="usage">
        <div className="section-head">
          <h2>How tokens are used</h2>
          <p>Your plan price is charged in Naira once per month. You do not receive a separate bill for each message.</p>
        </div>
        <div className="feature-grid">
          <article className="card feature">
            <h3>Every request uses tokens</h3>
            <p>Tokens are the small pieces of your prompt and the reply. Zuri counts both input and output tokens after each request.</p>
          </article>
          <article className="card feature">
            <h3>Premium models use more allowance</h3>
            <p>Each model has a weight. For example, 1,000 raw tokens on a weight-10 model uses 10,000 allowance tokens. This keeps the plans predictable.</p>
          </article>
          <article className="card feature">
            <h3>What you pay in Naira</h3>
            <p>Starter is NGN 2,499, Pro is NGN 6,000, Power is NGN 15,000, and Max is NGN 40,000 per month. Your dashboard shows the remaining allowance.</p>
          </article>
        </div>
      </section>

      <Footer />
    </main>
  );
}
