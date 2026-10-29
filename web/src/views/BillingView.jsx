import { DataRow } from '../components/DataRow.jsx';
import { formatDate, formatNaira, formatTokens } from '../lib/format.js';

function statusChip(status) {
  const value = String(status ?? '').toLowerCase();
  const tone = value === 'success' || value === 'active'
    ? ' chip-success'
    : value === 'failed' || value === 'past_due' || value === 'reversed'
      ? ' chip-danger'
      // A payment still on its way is news, not a failure, so it reads amber.
      : value === 'pending' || value === 'processing' || value === 'abandoned'
        ? ' chip-warning'
        : '';
  return <span className={`chip${tone}`}>{value || 'unknown'}</span>;
}

/** Subscription state plus the last 20 payments. */
export default function BillingView({ me, billing, usage }) {
  const subscription = me?.subscription ?? {};
  const payments = billing?.payments ?? [];
  // An administrator is never charged: the plan is given in Admin, on the People
  // list, so this screen says so instead of reading like an unpaid bill.
  const isAdmin = me?.user?.isAdmin === true;
  // Purchased tokens that have not expired yet; they sit inside the period
  // allowance the Usage screen counts, so they are shown next to the plan.
  const extraTokens = Math.max(0, Math.floor(Number(usage?.extraTokens) || 0));
  // A plan with no period yet reads better as one sentence than as two "Not set" dates.
  const periodStart = subscription.currentPeriodStart ?? billing?.subscription?.current_period_start;
  const periodEnd = subscription.currentPeriodEnd ?? billing?.subscription?.current_period_end;

  return (
    <section className="view calm">
      <div className="view-head">
        <div>
          <h1>Billing</h1>
          <p>Subscription and payment history for this account.</p>
        </div>
      </div>

      <div className="calm-section">
        <h2>Subscription</h2>
        <div className="calm-lines">
          <DataRow label="Plan">{subscription.status === 'pending' ? 'No active plan' : subscription.planName ?? billing?.subscription?.plan_name ?? 'Starter'}</DataRow>
          <DataRow label="Status">{statusChip(billing?.subscription?.status ?? subscription.status ?? 'active')}</DataRow>
          <DataRow label="Current period">
            {periodEnd ? `${formatDate(periodStart)} to ${formatDate(periodEnd)}` : 'Your plan renews every month'}
          </DataRow>
          {extraTokens > 0 && (
            <DataRow label="Extra tokens">
              {formatTokens(extraTokens)} tokens, counted in this period's allowance
            </DataRow>
          )}
          {isAdmin && (
            <DataRow label="Payment">
              None due. This is an administrator's account, so its plan is given, not bought.
            </DataRow>
          )}
        </div>
      </div>

      <div className="calm-section">
        <h2>Payments</h2>
        {payments.length === 0 ? (
          <p className="calm-help">
            {isAdmin
              ? 'Nothing to pay: plans are put on an account from the Admin tab.'
              : 'No payments yet. Paid plans appear here after checkout.'}
          </p>
        ) : (
          <div className="calm-lines">
            {payments.map((payment) => (
              <div className="row" key={payment.reference ?? payment.created_at}>
                <div>
                  <div>{formatNaira(payment.amount_kobo)}</div>
                  {/* Older records carry no kind, so only a top-up adds this line. */}
                  {payment.kind === 'topup' && (
                    <div className="row-meta">
                      {payment.packName ?? 'Extra usage'}
                      {Number(payment.tokensGranted) > 0
                        ? ` - ${formatTokens(payment.tokensGranted)} tokens`
                        : ''}
                    </div>
                  )}
                  <div className="row-meta">
                    {payment.plan_code ?? (payment.kind === 'topup' ? 'Top-up' : 'plan')} - {payment.reference ?? ''}
                  </div>
                </div>
                <div className="row-meta" style={{ textAlign: 'right' }}>
                  {statusChip(payment.status)}
                  <div>{formatDate(payment.paid_at ?? payment.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
