import { formatNaira, formatTokens } from '../lib/format.js';

export default function AdminStats({ overview, rate }) {
  return (
    <section className="admin-section">
      <div className="admin-section-heading">
        <div>
          <h2>Business snapshot</h2>
          <p>Revenue and supplier spend for the selected period.</p>
        </div>
      </div>
      <div className="admin-stat-lines">
        <div><span>Revenue</span><strong>{formatNaira(overview.revenueKobo)}</strong><small>Successful payments in the period.</small></div>
        <div><span>Supplier cost</span><strong>{formatNaira(overview.costKobo)}</strong><small>At {formatNaira(Math.round(rate * 100))} per US dollar.</small></div>
        <div><span>Margin</span><strong>{formatNaira(overview.marginKobo)}</strong><small>{overview.users} active accounts.</small></div>
        <div><span>Requests</span><strong>{formatTokens(overview.spendByModel.reduce((total, row) => total + (Number(row.requests) || 0), 0))}</strong><small>Across the models in this period.</small></div>
      </div>
    </section>
  );
}
