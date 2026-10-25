import { DataRow } from '../components/DataRow.jsx';
import { formatDate, formatNaira } from '../lib/format.js';

function statusChip(status) {
  const value = String(status ?? '').toLowerCase();
  const tone = value === 'success' || value === 'active'
    ? ' chip-success'
    : value === 'failed' || value === 'past_due'
      ? ' chip-danger'
      : '';
  return <span className={`chip${tone}`}>{value || 'unknown'}</span>;
}

/** Subscription state plus the last 20 payments. */
export default function BillingView({ me, billing }) {
  const subscription = me?.subscription ?? {};
  const payments = billing?.payments ?? [];

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Billing</h1>
          <p>Subscription and payment history for this account.</p>
        </div>
      </div>

      <article className="card">
        <p className="stat-label">Subscription</p>
        <div className="row-list" style={{ marginTop: 8 }}>
          <DataRow label="Plan">{subscription.planName ?? 'Starter'}</DataRow>
          <DataRow label="Status">{statusChip(billing?.subscription?.status ?? 'active')}</DataRow>
          <DataRow label="Current period">
            {formatDate(subscription.currentPeriodStart)} to {formatDate(subscription.currentPeriodEnd)}
          </DataRow>
        </div>
      </article>

      <article className="card">
        <p className="stat-label">Payments</p>
        {payments.length === 0 ? (
          <p className="empty" style={{ marginTop: 8 }}>
            No payments yet. Paid plans appear here after checkout.
          </p>
        ) : (
          <div className="row-list" style={{ marginTop: 8 }}>
            {payments.map((payment) => (
              <div className="row" key={payment.reference ?? payment.created_at}>
                <div>
                  <div>{formatNaira(payment.amount_kobo)}</div>
                  <div className="row-meta">
                    {payment.plan_code ?? 'plan'} - {payment.reference ?? ''}
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
      </article>
    </section>
  );
}
