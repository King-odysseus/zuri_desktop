import { formatNaira, formatTokens } from '../lib/format.js';

export default function AdminPlans({ plans }) {
  return <section className="admin-section"><div className="admin-section-heading"><div><h2>Plans and limits</h2><p>Allowance and request limits currently assigned to each plan.</p></div></div><div className="admin-scroll"><table className="admin-table admin-plans-table"><thead><tr><th>Plan</th><th>Price</th><th>Monthly tokens</th><th>Requests per minute</th><th>At once</th><th>Subscribers</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.code}><td>{plan.name}</td><td>{formatNaira(plan.amountKobo)}</td><td>{formatTokens(plan.monthlyTokens)}</td><td>{plan.limits ? formatTokens(plan.limits.requestsPerMinute) : '-'}</td><td>{plan.limits ? formatTokens(plan.limits.maxConcurrent) : '-'}</td><td>{formatTokens(plan.subscribers)}</td></tr>)}</tbody></table></div></section>;
}
