import { useEffect, useState } from 'react';
import { AlertTriangle, CreditCard, Gauge, MessageSquare, Plus, Sparkles, Wallet } from 'lucide-react';
import { fetchConversations } from '../lib/api.js';
import { formatDate, formatNaira, formatRelativeTime, formatTokens, greetingFor } from '../lib/format.js';

// Monday first, so the weekday row reads like a working week.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const QUICK_ACTIONS = [
  { view: 'chat', title: 'Ask Zuri', subtitle: 'Start a chat', Icon: Sparkles },
  { view: 'usage', title: 'Usage and limits', subtitle: 'Tokens and requests', Icon: Gauge },
  { view: 'plans', title: 'Plans', subtitle: 'Change your plan', Icon: CreditCard },
  { view: 'billing', title: 'Billing', subtitle: 'Payments and receipts', Icon: Wallet },
];

// One tone per state: the icon and the action take the colour, the sentence stays
// in the body colour so it is readable in both themes.
const BANNER_TONES = {
  danger: 'text-danger',
  warning: 'text-warning',
  accent: 'text-accent',
};

// The card shell every panel shares: white on the canvas, hairline border, 16px.
const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-hairline bg-surface p-4';

/** A usable Date for a value the server may have left out, or null. */
function dateFor(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Local calendar day key, so two stamps on the same day the reader sees compare equal. */
function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** 0 for Monday through 6 for Sunday, matching DAY_LABELS. */
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** "14:35" for a timestamp, so a row can say when inside the day something happens. */
function clockLabel(date) {
  return date.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The seven bars under "Chats this week".
 *
 * The API exposes no daily usage series, so the only dated thing this screen can
 * honestly count is the saved conversations and the day each was last active.
 * Seven consecutive days hold every weekday exactly once, so the window is the
 * last seven days shown in weekday order: that keeps the labels Monday to Sunday
 * while still describing recent activity rather than a calendar week whose early
 * days are already gone. A day with no conversation keeps a short stub so the row
 * still reads as a chart instead of a gap.
 */
function buildWeekBars(conversations, now = new Date()) {
  const counts = new Map();
  for (const conversation of conversations) {
    const stamp = dateFor(conversation?.updatedAt ?? conversation?.createdAt);
    if (!stamp) continue;
    const key = dayKey(stamp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = dayKey(now);
  const days = [];
  for (let back = 6; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const key = dayKey(date);
    days.push({
      key,
      label: DAY_LABELS[weekdayIndex(date)],
      count: counts.get(key) ?? 0,
      isToday: key === today,
    });
  }

  days.sort((left, right) => DAY_LABELS.indexOf(left.label) - DAY_LABELS.indexOf(right.label));
  return days;
}

/** Newest first, whatever order the server answered in. */
function newestFirst(conversations) {
  const stampOf = (conversation) =>
    dateFor(conversation?.updatedAt ?? conversation?.createdAt)?.getTime() ?? 0;
  return [...conversations].sort((left, right) => stampOf(right) - stampOf(left));
}

/** The small date tile in a "Coming up" row. */
function badgeFor(date) {
  return {
    day: String(date.getDate()),
    month: date.toLocaleDateString('en-NG', { month: 'short' }).toUpperCase(),
  };
}

/**
 * First screen after sign-in: the greeting, the shortcuts, the allowance and the
 * account's own dates.
 *
 * Everything comes from `me` and `usage`, except the two chat panels, which read the
 * conversation list because the API has no daily usage series to draw a week from.
 *
 * @param {{
 *   me?: { user?: object, subscription?: object },
 *   usage?: object,
 *   onViewChange?: (view: string) => void,
 * }} props
 */
export default function OverviewView({ me, usage, onViewChange }) {
  const user = me?.user ?? {};
  const subscription = me?.subscription ?? {};
  const quota = usage ?? {};
  // The rolling allowance, when the server measured one. Named apart from the
  // browser's own `window` so nothing here reads the wrong object.
  const rolling = quota.window ?? {};

  // A failed history read must not take the dashboard down, so the list has three
  // states and the two cards that use it say so quietly in the last two.
  const [chats, setChats] = useState([]);
  const [chatState, setChatState] = useState('loading');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const list = await fetchConversations();
        if (cancelled) return;
        setChats(Array.isArray(list) ? list : []);
        setChatState('ready');
      } catch (error) {
        if (cancelled) return;
        // Logged rather than swallowed: a quiet line on the page is enough for the
        // reader, but the console should still say why both panels are empty.
        console.warn('[zuri-cloud] overview conversations', error?.message ?? error);
        setChats([]);
        setChatState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // A missing display name is not an error: greetingFor then greets with no name,
  // and the muted line under the heading still names the signed-in account.
  const greeting = greetingFor(user.displayName || 'Zuri user');

  const planName = typeof subscription.planName === 'string' ? subscription.planName.trim() : '';
  const planText = planName || 'Not set';
  const planSummary = planName ? `${planName} plan` : 'No plan chosen yet';

  const usedTokens = Math.max(0, Number(quota.usedTokens) || 0);
  const monthlyTokens = Math.max(0, Number(quota.monthlyTokens) || 0);
  const remainingTokens = Math.max(0, Number(quota.remainingTokens) || 0);
  const extraTokens = Math.max(0, Number(quota.extraTokens) || 0);
  const percentUsed = Math.min(100, Math.max(0, Math.round(Number(quota.percentUsed) || 0)));

  const periodEnd = dateFor(subscription.currentPeriodEnd);
  const periodStart = dateFor(subscription.currentPeriodStart);
  const windowReset = dateFor(rolling.resetsAt);

  const subline = user.email ? `${planSummary}, signed in as ${user.email}` : planSummary;

  // One line only, in this order of importance: no allowance, no paid plan, then
  // nearly out of allowance.
  const banner = quota.overQuota
    ? {
        tone: 'danger',
        message:
          'Your token allowance is used up. Requests fail until the period renews or you move to a bigger plan.',
        action: 'Manage plan',
      }
    : subscription.status === 'pending'
      ? {
          tone: 'accent',
          message: 'Choose a paid plan to unlock chat and model access.',
          action: 'See plans',
        }
      : quota.nearLimit
        ? {
            tone: 'warning',
            message: 'You are close to the token allowance for this billing period.',
            action: 'Manage plan',
          }
        : null;

  const stats = [
    {
      label: 'Tokens left',
      value: formatTokens(remainingTokens),
      note: `of ${formatTokens(monthlyTokens)} this month`,
    },
    {
      label: 'Tokens used',
      value: `${percentUsed}%`,
      note: 'this billing period',
    },
    {
      label: 'Plan',
      value: planText,
      note: periodEnd ? `renews ${formatDate(periodEnd)}` : 'no renewal date yet',
    },
    {
      label: 'Extra tokens',
      value: formatTokens(extraTokens),
      note: extraTokens > 0 ? 'purchased, not expired' : 'none bought',
    },
  ];

  // The account's own dates, and nothing invented: the renewal, the period start and
  // the moment a rolling window frees up when the server measured one.
  const upcoming = [];
  if (periodEnd) {
    upcoming.push({ key: 'renews', label: 'Plan renews', meta: formatDate(periodEnd), date: periodEnd });
  }
  if (periodStart) {
    upcoming.push({ key: 'started', label: 'Period started', meta: formatDate(periodStart), date: periodStart });
  }
  if (windowReset) {
    upcoming.push({
      key: 'window',
      label: 'Usage frees up',
      meta: `${clockLabel(windowReset)} on ${formatDate(windowReset)}`,
      date: windowReset,
    });
  }

  // The plan's price is not part of this screen's props, so it is read where an
  // account may carry it and otherwise shown as "Not set" rather than guessed from
  // the plan's name.
  const monthlyPrice = [subscription.amountKobo, subscription.priceKobo, quota.amountKobo].find(
    (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );

  const bars = buildWeekBars(chats);
  const peak = Math.max(1, ...bars.map((bar) => bar.count));
  const barHeight = (count) => (count === 0 ? 4 : Math.max(12, Math.round((count / peak) * 88)));
  const barsLabel = `Chats last active in the last seven days: ${bars
    .map((bar) => `${bar.label} ${bar.count}`)
    .join(', ')}`;

  const recentChats = newestFirst(chats).slice(0, 4);
  const chatsFailed = chatState === 'error';
  const chatsLoading = chatState === 'loading';
  const toneClass = banner ? BANNER_TONES[banner.tone] : '';

  return (
    <section className="flex w-full min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-[25px] font-bold leading-tight tracking-tight text-body">
            {greeting}
          </h1>
          <p className="break-words text-[13px] leading-snug text-muted">{subline}</p>
        </div>
        <button
          type="button"
          onClick={() => onViewChange?.('chat')}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[13px] font-semibold text-[color:var(--accent-foreground)] transition-colors hover:bg-accent-hover sm:min-h-10 sm:w-auto"
        >
          <Plus className="size-4" aria-hidden="true" />
          New chat
        </button>
      </header>

      {banner && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-hairline bg-surface px-3.5 py-2.5"
        >
          <AlertTriangle className={`size-4 shrink-0 ${toneClass}`} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-body">{banner.message}</p>
          <button
            type="button"
            onClick={() => onViewChange?.('plans')}
            className={`shrink-0 text-[12px] font-semibold hover:underline ${toneClass}`}
          >
            {banner.action}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {QUICK_ACTIONS.map(({ view, title, subtitle, Icon }) => (
          <button
            key={view}
            type="button"
            onClick={() => onViewChange?.(view)}
            className="flex min-h-11 min-w-0 flex-col items-start gap-2 rounded-xl border border-hairline bg-surface p-3.5 text-left transition-colors hover:bg-surface-secondary lg:flex-row lg:items-center lg:gap-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon className="size-[18px]" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="break-words text-[13px] font-semibold leading-snug text-body">{title}</span>
              <span className="break-words text-[11.5px] leading-snug text-muted">{subtitle}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex min-w-0 flex-col gap-1 rounded-xl border border-hairline bg-surface p-3.5"
          >
            <p className="break-words text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              {stat.label}
            </p>
            <p className="break-words text-[22px] font-bold leading-tight tracking-tight text-body">
              {stat.value}
            </p>
            <p className="break-words text-[11px] leading-snug text-faint">{stat.note}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-body">Chats this week</h2>
            <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent-text">
              {planName ? `${planName} plan` : 'No plan yet'}
            </span>
          </div>

          {chatsFailed ? (
            <p className="text-[11.5px] leading-snug text-faint">Chats could not be loaded.</p>
          ) : chatsLoading ? (
            <p className="text-[11.5px] leading-snug text-faint">Loading chats.</p>
          ) : (
            <div role="img" aria-label={barsLabel} className="flex items-end justify-between gap-1.5 sm:gap-2">
              {bars.map((bar) => (
                <div key={bar.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-20 w-full items-end">
                    <div
                      className={`mx-auto w-full max-w-11 rounded-t-[6px] ${bar.isToday ? 'bg-accent' : 'bg-accent-soft'}`}
                      style={{ height: `${barHeight(bar.count)}%` }}
                    />
                  </div>
                  <span
                    className={`text-[10px] leading-none ${
                      bar.isToday ? 'font-semibold text-body' : 'text-faint'
                    }`}
                  >
                    {bar.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div
              role="progressbar"
              aria-valuenow={percentUsed}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Share of this period's token allowance used"
              className="h-2 w-full overflow-hidden rounded-full bg-surface-secondary"
            >
              <div
                className={`h-full rounded-full ${
                  quota.overQuota ? 'bg-danger' : quota.nearLimit ? 'bg-warning' : 'bg-accent'
                }`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-[11px] leading-snug text-muted">
                {`${formatTokens(usedTokens)} of ${formatTokens(monthlyTokens)} tokens used (${percentUsed}%)`}
              </p>
              <button
                type="button"
                onClick={() => onViewChange?.('plans')}
                className="text-[11px] font-semibold text-accent hover:underline"
              >
                Manage plan
              </button>
            </div>
          </div>
        </div>

        <div className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-body">Coming up</h2>
            <button
              type="button"
              onClick={() => onViewChange?.('usage')}
              className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
            >
              See all
            </button>
          </div>

          {upcoming.length === 0 ? (
            <p className="text-[11.5px] leading-snug text-faint">Your plan has no dates to show yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {upcoming.map((row) => {
                const badge = badgeFor(row.date);
                return (
                  <div key={row.key} className="flex min-w-0 items-center gap-3">
                    <span className="flex size-[34px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[10px] bg-accent-soft text-accent-text">
                      <span className="text-[13px] font-bold leading-none">{badge.day}</span>
                      <span className="text-[8px] font-semibold uppercase leading-none tracking-[0.06em]">
                        {badge.month}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] font-medium leading-snug text-body">
                        {row.label}
                      </span>
                      <span className="truncate text-[11px] leading-snug text-muted">{row.meta}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-body">Recent chats</h2>
            <button
              type="button"
              onClick={() => onViewChange?.('chat')}
              className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
            >
              See all
            </button>
          </div>

          {chatsFailed ? (
            <p className="text-[11.5px] leading-snug text-faint">Chats could not be loaded.</p>
          ) : chatsLoading ? (
            <p className="text-[11.5px] leading-snug text-faint">Loading chats.</p>
          ) : recentChats.length === 0 ? (
            <p className="text-[11.5px] leading-snug text-faint">
              No saved chats yet. Ask Zuri a question to start one.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {recentChats.map((conversation) => (
                <div key={conversation.id} className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <MessageSquare className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug text-body">
                    {conversation.title || 'New chat'}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {formatRelativeTime(conversation.updatedAt ?? conversation.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={CARD}>
          <h2 className="text-[13px] font-semibold text-body">Billing period</h2>

          <div className="flex flex-col divide-y divide-hairline">
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <span className="shrink-0 text-[11px] text-muted">Plan</span>
              <span className="min-w-0 break-words text-right text-[12.5px] font-medium text-body">
                {planText}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2">
              <span className="shrink-0 text-[11px] text-muted">Amount each month</span>
              <span className="min-w-0 break-words text-right text-[12.5px] font-medium text-body">
                {monthlyPrice === undefined ? 'Not set' : formatNaira(monthlyPrice)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-2">
              <span className="shrink-0 text-[11px] text-muted">Period ends</span>
              <span className="min-w-0 break-words text-right text-[12.5px] font-medium text-body">
                {periodEnd ? formatDate(periodEnd) : 'Not set'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-[11px] leading-snug text-faint">Receipts and past payments are in Billing.</p>
            <button
              type="button"
              onClick={() => onViewChange?.('billing')}
              className="text-[11px] font-semibold text-accent hover:underline"
            >
              Open billing
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
