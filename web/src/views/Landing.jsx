import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  FileText,
  Gauge,
  ListChecks,
  MessageSquare,
  Sparkles,
  Zap,
} from 'lucide-react';
import Footer from '../components/Footer.jsx';
import DownloadList from '../components/DownloadList.jsx';
import ImagePrices from '../components/ImagePrices.jsx';
import { fetchImagePrices } from '../lib/api.js';
import { formatNaira, formatTokens } from '../lib/format.js';

// The signed-out page's frame: every band spans the window, and this string pulls
// its contents into one centred column. Kept in one place so no band drifts.
const CONTAINER = 'mx-auto w-full max-w-[1200px] px-5 sm:px-8 lg:px-10';
// Section anchor offset: the site's top bar is sticky and 64px tall, so a jump to
// #features would otherwise park the heading underneath it.
const ANCHOR = 'scroll-mt-[72px]';
// The frame colour of the app mock. The theme is an attribute on <html>, not a
// class, so the dark variant is written against [data-theme=dark] rather than with
// Tailwind's dark: variant.
const NAVY = 'bg-[#0b1f3a] [[data-theme=dark]_&]:bg-[#0a1226]';
// The accent's own foreground token, so a send glyph stays legible when
// the dark theme swaps the accent for a pale lavender.
const ON_ACCENT = 'text-[color:var(--accent-foreground)]';

const HERO_POINTS = [
  'One account for desktop and web',
  'Pay monthly, cancel any time',
  'See your usage before you hit a limit',
];

const FEATURES = [
  {
    Icon: MessageSquare,
    title: 'Chat that keeps context',
    body: 'Ask once and follow up later. Zuri holds the thread and your notes together.',
  },
  {
    Icon: ListChecks,
    title: 'Tasks and reminders',
    body: 'Write it the way you say it. Zuri turns it into a task with a time attached.',
  },
  {
    Icon: Zap,
    title: 'Automations',
    body: 'Put the repeating work on a schedule: weekly reports, tidy ups, standing reminders.',
  },
  {
    Icon: FileText,
    title: 'Files in, documents out',
    body: 'Drop a brief, a spreadsheet or a PDF and get a clean draft back in minutes.',
  },
  {
    Icon: Bot,
    title: 'Agents',
    body: 'Small helpers that watch a project and report back when something moves.',
  },
  {
    Icon: Gauge,
    title: 'Usage you can see',
    body: 'A live counter of tokens and credits, so a limit never arrives as a surprise.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Create your account',
    body: 'Sign in with an email or Google account. The same login opens the desktop app and the web dashboard.',
  },
  {
    number: '02',
    title: 'Choose a plan',
    body: 'Pick a monthly plan and pay in Naira. Change or cancel whenever you need to.',
  },
  {
    number: '03',
    title: 'Ask Zuri',
    body: 'Start with a question, a reminder or a half written brief. Zuri picks up the context from there.',
  },
];

// One short line per plan. Copy only: the price, the name and the allowance are
// always read from the plans the server sent, never written here.
const PLAN_BLURBS = {
  starter: 'A light allowance for trying things out.',
  pro: 'For most days of steady asking.',
  power: 'For long documents and heavier research.',
  max: 'For the busiest accounts and longest threads.',
};

/** @param {{ code?: string }} plan */
function describePlan(plan) {
  return PLAN_BLURBS[String(plan?.code ?? '').toLowerCase()] ?? 'A monthly allowance of tokens.';
}

/**
 * A real screenshot of the running app, taken at 1280x800 from the signed-in chat.
 * It replaced a drawing that invented a greeting, tasks and a chart, so the page now
 * shows the app a visitor will actually open. The frame is decorative: the copy beside
 * it already says what the product does, so it is hidden from assistive technology.
 */
function AppPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[560px] lg:mx-0 lg:max-w-none" aria-hidden="true">
      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-glass)]">
        <img
          src="/img/app-preview.png"
          alt=""
          width="1280"
          height="800"
          loading="lazy"
          decoding="async"
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}

/**
 * Signed-out marketing page: the promise, the six pieces, how to start, then the
 * plans. The sign-in form itself lives on /signin and /signup, so one screen keeps
 * one job.
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
    <main className="relative z-10 flex w-full flex-col bg-canvas">

      <section className={`${CONTAINER} py-12 sm:py-16 lg:py-20`}>
        <div className="grid items-center gap-12 lg:grid-cols-[46fr_54fr] lg:gap-14">
          <div className="flex min-w-0 flex-col items-start gap-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              Your AI workspace
            </span>

            <h1 className="text-[2rem] font-bold leading-[1.08] tracking-[-0.03em] text-body sm:text-[2.75rem] lg:text-[3.375rem]">
              Chats, tasks and documents in one calm place.
            </h1>

            <p className="max-w-[48ch] text-[15px] leading-[1.6] text-muted sm:text-[17px]">
              Zuri is an assistant that remembers what you are working on. Ask a question, set a reminder or
              draft a document, on the desktop or in the browser.
            </p>

            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <button
                type="button"
                onClick={() => onNavigate('/signup')}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold transition-colors hover:bg-accent-hover ${ON_ACCENT}`}
              >
                Start with Zuri
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/#how')}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-hairline bg-surface px-5 text-[14px] font-semibold text-body transition-colors hover:bg-surface-secondary"
              >
                See the app
              </button>
            </div>

            <ul className="flex flex-col gap-2 text-[13.5px] text-muted">
              {HERO_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <AppPreview />
        </div>
      </section>

      <div className="w-full border-y border-hairline bg-surface">
        <div className={`${CONTAINER} flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8`}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Works with</span>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] font-medium text-muted">
            <li>Word</li>
            <li>Excel</li>
            <li>PowerPoint</li>
            <li>Google sign-in</li>
          </ul>
        </div>
      </div>

      <section id="features" className={`${ANCHOR} w-full bg-surface-secondary`}>
        <div className={`${CONTAINER} flex flex-col gap-10 py-14 sm:py-16 lg:py-24`}>
          <div className="mx-auto flex max-w-[600px] flex-col items-center gap-3 text-center">
            <h2 className="text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-body sm:text-[32px]">
              Everything you need, nothing in the way
            </h2>
            <p className="text-[14.5px] leading-[1.6] text-muted">
              Six pieces that cover the work between a question and a finished document.
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, body }) => (
              <li
                key={title}
                className="flex min-w-0 flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="text-[14px] font-bold text-body">{title}</h3>
                <p className="text-[12.5px] leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className={`${ANCHOR} w-full bg-canvas`}>
        <div className={`${CONTAINER} grid gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24`}>
          <div className="flex min-w-0 flex-col items-start gap-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">How it works</span>
            <h2 className="max-w-[22ch] text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-body sm:text-[28px]">
              Three steps and Zuri is working with you.
            </h2>
            <p className="max-w-[44ch] text-[14.5px] leading-[1.6] text-muted">
              No setup calls and no training week. Most people send their first task within a few minutes.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/signup')}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold transition-colors hover:bg-accent-hover ${ON_ACCENT}`}
            >
              Create an account
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>

          </div>

          <ul className="flex min-w-0 flex-col gap-3">
            {STEPS.map((step) => (
              <li
                key={step.number}
                className="flex min-w-0 items-start gap-3 rounded-xl bg-surface-secondary p-4"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-bold text-accent">
                  {step.number}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-[14px] font-bold text-body">{step.title}</span>
                  <span className="text-[12.5px] leading-relaxed text-muted">{step.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" className={`${ANCHOR} w-full bg-surface`}>
        <div className={`${CONTAINER} flex flex-col gap-10 py-14 sm:py-16 lg:py-24`}>
          <div className="mx-auto flex max-w-[600px] flex-col items-center gap-3 text-center">
            <h2 className="text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-body sm:text-[32px]">
              Simple monthly plans
            </h2>
            <p className="text-[14.5px] leading-[1.6] text-muted">
              Prices in Naira, billed monthly. Change or cancel any time.
            </p>
          </div>

          {plans.length === 0 ? (
            <p className="self-center w-full max-w-[560px] rounded-2xl border border-hairline bg-surface-secondary p-5 text-center text-[13px] text-muted">
              Plans could not be loaded. Reload the page to try again.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan) => {
                const featured = String(plan.code).toLowerCase() === 'pro';
                const working = busy === plan.code;
                return (
                  <li
                    key={plan.code}
                    className={`relative flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-5 ${
                      featured
                        ? 'border-2 border-accent shadow-[var(--shadow-soft)]'
                        : 'border border-hairline'
                    }`}
                  >
                    {featured && (
                      <span
                        className={`absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${ON_ACCENT}`}
                      >
                        Popular
                      </span>
                    )}

                    <h3 className="pr-16 text-[15px] font-bold text-body">{plan.name}</h3>

                    <div className="flex flex-col gap-0.5">
                      <p className="text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-body">
                        {formatNaira(plan.amountKobo)}
                      </p>
                      <p className="text-[12px] text-muted">per month</p>
                    </div>

                    <p className="text-[12.5px] leading-snug text-muted">{describePlan(plan)}</p>

                    <span className="block h-px w-full bg-hairline" />

                    <p className="text-[12.5px] text-muted">
                      {formatTokens(plan.monthlyTokens)} tokens each month
                    </p>

                    <button
                      type="button"
                      onClick={() => onChoose(plan.code)}
                      disabled={working}
                      className={`mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        featured
                          ? `bg-accent hover:bg-accent-hover ${ON_ACCENT}`
                          : 'border border-hairline bg-surface-secondary text-body hover:bg-surface-tertiary'
                      }`}
                    >
                      {working ? 'Opening checkout...' : `Choose ${plan.name}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="w-full bg-canvas">
        <div className={`${CONTAINER} flex flex-col gap-4 py-14 sm:py-16 lg:py-24`}>
          <div className="flex max-w-[600px] flex-col gap-2">
            <h2 className="text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-body sm:text-[28px]">
              Get the Zuri desktop app
            </h2>
            <p className="text-[14px] leading-[1.6] text-muted">
              Install Zuri on your computer to keep your assistant, files and automations close at hand. The
              download starts straight away.
            </p>
          </div>
          <DownloadList />
        </div>
      </section>

      {imagePrices.length > 0 && (
        <section id="images" className={`${ANCHOR} w-full bg-surface`}>
          <div className={`${CONTAINER} flex flex-col gap-4 py-14 sm:py-16 lg:py-24`}>
            <div className="flex max-w-[600px] flex-col gap-2">
              <h2 className="text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-body sm:text-[28px]">
                Pictures, priced in Naira
              </h2>
              <p className="text-[14px] leading-[1.6] text-muted">
                Images are paid for out of the same monthly allowance as your messages, so a picture never adds
                a second line to your bill.
              </p>
            </div>
            <ImagePrices imagePrices={imagePrices} plans={plans} />
          </div>
        </section>
      )}

      <section className="w-full bg-canvas pb-14 sm:pb-16 lg:pb-24">
        <div className={CONTAINER}>
          <div
            className={`flex flex-col items-start gap-6 rounded-2xl px-6 py-8 sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:justify-between lg:gap-10 ${NAVY}`}
          >
            <div className="flex max-w-[54ch] flex-col gap-2">
              <h2 className="text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-white sm:text-[28px]">
                Ready to try Zuri?
              </h2>
              <p className="text-[14px] leading-[1.6] text-white/75">
                Open the web dashboard and start with a question. No card needed to look around, and you can
                move to the desktop app with the same account.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/signup')}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-white px-6 text-[14px] font-semibold text-[#0b1f3a] transition-colors hover:bg-white/90 lg:w-auto lg:shrink-0"
            >
              Start free
            </button>
          </div>
        </div>
      </section>

      <div className={`${CONTAINER} pb-10`}>
        <Footer />
      </div>
    </main>
  );
}
