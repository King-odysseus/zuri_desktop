import { useEffect, useState } from 'react';
import { PlusIcon } from '../../../src/renderer-react/Icons.jsx';
import { fetchConversations } from '../lib/api.js';
import { formatDate, formatNaira, formatRelativeTime, formatTokens, greetingFor } from '../lib/format.js';

// Monday first, so the weekday row reads like a working week.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const QUICK_ACTIONS = [
  { view: 'chat', title: 'Ask Zuri', subtitle: 'Start a chat' },
  { view: 'usage', title: 'Usage and limits', subtitle: 'Tokens and requests' },
  { view: 'plans', title: 'Plans', subtitle: 'Change your plan' },
  { view: 'billing', title: 'Billing', subtitle: 'Payments and receipts' },
];

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

  return (
    <section className="view calm">
      <div className="view-head">
        <div className="min-w-0 overview-greeting">
          <h1 className="break-words">{greeting}</h1>
          <p className="break-words">{subline}</p>
        </div>
      </div>

      {banner && (
        // The note keeps its own spacing, so the tone is a colour class on it
        // rather than the alert panel, which would move the buttons below it.
        <div role="status" className={`calm-note ${banner.tone === 'danger' ? 'is-danger' : banner.tone === 'warning' ? 'is-warning' : 'is-info'}`}>
          {banner.message}{' '}
          <button type="button" onClick={() => onViewChange?.('plans')} className="calm-link">
            {banner.action}
          </button>
        </div>
      )}

      <div className="calm-actions" style={{ paddingBottom: 22 }}>
        <button type="button" onClick={() => onViewChange?.('chat')} className="calm-primary">
          <PlusIcon className="size-4" aria-hidden="true" />
          New chat
        </button>
      </div>

      <div className="calm-section">
        <div className="calm-section-head">
          <h2>Your allowance</h2>
          <button type="button" onClick={() => onViewChange?.('plans')} className="calm-link">
            Manage plan
          </button>
        </div>
        <div
          role="progressbar"
          aria-valuenow={percentUsed}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Share of this period's token allowance used"
          className="calm-bar"
        >
          <div
            className={quota.overQuota ? 'is-danger' : quota.nearLimit ? 'is-warn' : ''}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
        <p className="calm-help">
          {`${formatTokens(usedTokens)} of ${formatTokens(monthlyTokens)} tokens used (${percentUsed}%)`}
        </p>
        <div className="calm-lines">
          {stats.map((stat) => (
            <div key={stat.label} className="calm-line">
              <span>{stat.label}</span>
              <span className="calm-value">
                {stat.value}
                <span className="calm-sub">{stat.note}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="calm-section">
        <h2>Chats this week</h2>
        {chatsFailed ? (
          <p className="calm-help">Chats could not be loaded.</p>
        ) : chatsLoading ? (
          <p className="calm-help">Loading chats.</p>
        ) : (
          <div role="img" aria-label={barsLabel} className="calm-week">
            {bars.map((bar) => (
              <div key={bar.key} className="calm-week-col">
                <div className="calm-week-track">
                  <div
                    className={`calm-week-bar${bar.isToday ? ' is-today' : ''}`}
                    style={{ height: `${barHeight(bar.count)}%` }}
                  />
                </div>
                <span className="calm-week-label">{bar.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="calm-section">
        <div className="calm-section-head">
          <h2>Recent chats</h2>
          <button type="button" onClick={() => onViewChange?.('chat')} className="calm-link">
            See all
          </button>
        </div>
        {chatsFailed ? (
          <p className="calm-help">Chats could not be loaded.</p>
        ) : chatsLoading ? (
          <p className="calm-help">Loading chats.</p>
        ) : recentChats.length === 0 ? (
          <p className="calm-help">No saved chats yet. Ask Zuri a question to start one.</p>
        ) : (
          <div className="calm-lines">
            {recentChats.map((conversation) => (
              <div key={conversation.id} className="calm-line">
                <span className="min-w-0 flex-1 truncate">{conversation.title || 'New chat'}</span>
                <span className="calm-help shrink-0">
                  {formatRelativeTime(conversation.updatedAt ?? conversation.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="calm-section">
        <div className="calm-section-head">
          <h2>Billing period</h2>
          <button type="button" onClick={() => onViewChange?.('billing')} className="calm-link">
            Open billing
          </button>
        </div>
        <div className="calm-lines">
          <div className="calm-line">
            <span>Plan</span>
            <span className="calm-value">{planText}</span>
          </div>
          <div className="calm-line">
            <span>Amount each month</span>
            <span className="calm-value">
              {monthlyPrice === undefined ? 'Not set' : formatNaira(monthlyPrice)}
            </span>
          </div>
          <div className="calm-line">
            <span>Period ends</span>
            <span className="calm-value">{periodEnd ? formatDate(periodEnd) : 'Not set'}</span>
          </div>
          {upcoming.map((row) => (
            <div key={row.key} className="calm-line">
              <span>{row.label}</span>
              <span className="calm-value">{row.meta}</span>
            </div>
          ))}
        </div>
        <p className="calm-help">Receipts and past payments are in Billing.</p>
      </div>

      <div className="calm-section">
        <h2>Go to</h2>
        <div className="calm-lines">
          {QUICK_ACTIONS.map(({ view, title, subtitle }) => (
            <button
              key={view}
              type="button"
              onClick={() => onViewChange?.(view)}
              className="calm-line"
              style={{ background: 'none', borderLeft: 0, borderRight: 0, borderBottom: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}
            >
              <span>{title}</span>
              <span className="calm-help">{subtitle}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
