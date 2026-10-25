import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/DataRow.jsx';
import { fetchAdminOverview, saveAdminModel } from '../lib/api.js';
import { formatNaira, formatTokens } from '../lib/format.js';

const SUPPLIERS = ['deepseek', 'moonshot', 'zai', 'openai', 'anthropic'];
const WINDOWS = [7, 30, 90];

const BLANK_MODEL = Object.freeze({
  code: '',
  name: '',
  supplier: 'deepseek',
  supplierModel: '',
  kind: 'text',
  usdPerImage: 0,
  quotaTokensPerImage: 0,
  imageQuality: '',
  inputUsdPerMillion: 0,
  outputUsdPerMillion: 0,
  quotaWeight: 1,
  outputQuotaWeight: 0,
  minPlan: 'starter',
  rateFactor: 1,
  isActive: true,
  sortOrder: 100,
});

const NUMBER_FIELDS = ['inputUsdPerMillion', 'outputUsdPerMillion', 'usdPerImage', 'quotaTokensPerImage', 'quotaWeight', 'outputQuotaWeight', 'rateFactor', 'sortOrder'];

/** Naira for a dollar price, so the operator sees what a model costs per million tokens at today's rate. */
function nairaPerMillion(usd, rate) {
  return formatNaira(Math.round(Number(usd) * Number(rate) * 100));
}

/** What one picture earns after the supplier is paid: the number to watch per model. */
function pictureMarginKobo(model) {
  return (Number(model?.priceKoboPerImage) || 0) - (Number(model?.supplierCostKoboPerImage) || 0);
}

/**
 * Administrator dashboard: which Zuri names exist, which supplier stands behind
 * each, what it costs, and what the platform earns after supplier spend. The
 * supplier names appear here and nowhere a customer can see.
 */
export default function AdminView() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await fetchAdminOverview(days));
      setError('');
    } catch (failure) {
      setError(failure.status === 403 ? 'This area is for Zuri administrators.' : failure.message);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(field, value) {
    setSaved('');
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setSaved('');
    try {
      const model = { ...draft };
      for (const field of NUMBER_FIELDS) model[field] = Number(model[field]);
      await saveAdminModel(model);
      setDraft(null);
      setSaved(`${model.name} saved.`);
      await load();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !overview) {
    return (
      <section className="view">
        <div className="view-head"><div><h1>Admin</h1></div></div>
        <Alert tone="danger">{error}</Alert>
      </section>
    );
  }
  if (!overview) {
    return (
      <section className="view">
        <div className="view-head"><div><h1>Admin</h1></div></div>
        <div className="skeleton" role="status" aria-label="Loading the admin report" />
      </section>
    );
  }

  const rate = overview.nairaPerUsd;
  const spendByCode = new Map(overview.spendByModel.map((row) => [row.modelCode, row]));
  const marginTone = overview.marginKobo < 0 ? 'danger' : undefined;

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Admin</h1>
          <p>The Zuri models customers see, the suppliers behind them, and what each costs to run.</p>
        </div>
        <label className="field admin-window">
          <span>Period</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {WINDOWS.map((value) => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert>{saved}</Alert>}
      {marginTone && <Alert tone="danger">Supplier spend is higher than revenue for this period. Review the quota weights and plan prices.</Alert>}

      <div className="stat-grid">
        <article className="card">
          <p className="stat-label">Revenue</p>
          <p className="stat-value">{formatNaira(overview.revenueKobo)}</p>
          <p className="stat-meta">Successful payments in the period.</p>
        </article>
        <article className="card">
          <p className="stat-label">Supplier cost</p>
          <p className="stat-value">{formatNaira(overview.costKobo)}</p>
          <p className="stat-meta">At {formatNaira(Math.round(rate * 100))} per US dollar.</p>
        </article>
        <article className="card">
          <p className="stat-label">Margin</p>
          <p className="stat-value">{formatNaira(overview.marginKobo)}</p>
          <p className="stat-meta">{overview.users} active accounts.</p>
        </article>
      </div>

      <article className="card">
        <div className="admin-head">
          <p className="stat-label">Models</p>
          <button type="button" className="btn btn-secondary" onClick={() => { setSaved(''); setDraft({ ...BLANK_MODEL }); }}>
            Add a model
          </button>
        </div>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Zuri name</th>
                <th>Supplier</th>
                <th>Plan</th>
                <th>Weight</th>
                <th>Rate</th>
                <th>Supplier cost</th>
                <th>Requests</th>
                <th>Spend</th>
                <th><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {overview.models.map((model) => {
                const spend = spendByCode.get(model.code);
                return (
                  <tr key={model.code} className={model.isActive ? '' : 'is-off'}>
                    <td>{model.name}<small>{model.code}{model.isActive ? '' : ' (off)'}</small></td>
                    <td>{model.supplier}<small>{model.supplierModel}</small></td>
                    <td>{model.minPlan}</td>
                    <td>
                      {model.quotaWeight}x
                      <small>replies {(model.outputQuotaWeight > 0 ? model.outputQuotaWeight : model.quotaWeight)}x</small>
                    </td>
                    <td>{Math.round(model.rateFactor * 100)}%</td>
                    <td>
                      {model.kind === 'image' ? (
                        <>
                          {formatNaira(model.supplierCostKoboPerImage)}
                          <small>sells at {formatNaira(model.priceKoboPerImage)} on {model.pricePlanName}</small>
                          <small>margin {formatNaira(pictureMarginKobo(model))} a picture</small>
                        </>
                      ) : (
                        <>
                          in {nairaPerMillion(model.inputUsdPerMillion, rate)}
                          <small>out {nairaPerMillion(model.outputUsdPerMillion, rate)}</small>
                        </>
                      )}
                    </td>
                    <td>{formatTokens(spend?.requests ?? 0)}</td>
                    <td>{formatNaira(spend?.costKobo ?? 0)}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => { setSaved(''); setDraft({ ...model }); }}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="stat-meta">
          Weight is how fast the model uses a customer's monthly allowance. Suppliers charge the reply at
          several times the prompt's rate, so replies carry their own weight: keep it at or above three times
          the output price per million, or a month spent on replies costs more than the plan earns. Rate is the
          share of the plan's requests per minute that the model gets.
        </p>
      </article>

      {draft && (
        <form className="card form-stack admin-form" onSubmit={save}>
          <p className="stat-label">{overview.models.some((model) => model.code === draft.code) ? `Edit ${draft.name}` : 'New model'}</p>
          <div className="admin-fields">
            <label className="field"><span>Code</span>
              <input value={draft.code} onChange={(event) => edit('code', event.target.value)} placeholder="zuri-flash" required />
            </label>
            <label className="field"><span>Name customers see</span>
              <input value={draft.name} onChange={(event) => edit('name', event.target.value)} placeholder="Zuri Flash" maxLength={40} required />
            </label>
            <label className="field"><span>Supplier (private)</span>
              <select value={draft.supplier} onChange={(event) => edit('supplier', event.target.value)}>
                {SUPPLIERS.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
              </select>
            </label>
            <label className="field"><span>Supplier model name</span>
              <input value={draft.supplierModel} onChange={(event) => edit('supplierModel', event.target.value)} required />
            </label>
            <label className="field"><span>Billed as</span>
              <select value={draft.kind ?? 'text'} onChange={(event) => edit('kind', event.target.value)}>
                <option value="text">Chat, by the token</option>
                <option value="image">Pictures, by the image</option>
              </select>
            </label>
            {draft.kind !== 'image' && (
              <>
                <label className="field"><span>Input price, USD per 1M tokens</span>
                  <input type="number" min="0" step="0.01" value={draft.inputUsdPerMillion} onChange={(event) => edit('inputUsdPerMillion', event.target.value)} />
                </label>
                <label className="field"><span>Output price, USD per 1M tokens</span>
                  <input type="number" min="0" step="0.01" value={draft.outputUsdPerMillion} onChange={(event) => edit('outputUsdPerMillion', event.target.value)} />
                </label>
              </>
            )}
            {draft.kind === 'image' && (
              <>
                <label className="field"><span>Supplier price, USD per picture</span>
                  <input type="number" min="0" step="0.001" value={draft.usdPerImage} onChange={(event) => edit('usdPerImage', event.target.value)} />
                </label>
                <label className="field"><span>Allowance tokens per picture</span>
                  <input type="number" min="1000" max="4000000" step="1000" value={draft.quotaTokensPerImage} onChange={(event) => edit('quotaTokensPerImage', event.target.value)} />
                </label>
                <label className="field"><span>Picture size label</span>
                  <input value={draft.imageQuality ?? ''} maxLength={20} onChange={(event) => edit('imageQuality', event.target.value)} placeholder="standard" />
                </label>
              </>
            )}
            <label className="field"><span>Quota weight (prompts)</span>
              <input type="number" min="0.1" max="100" step="0.1" value={draft.quotaWeight} onChange={(event) => edit('quotaWeight', event.target.value)} />
            </label>
            <label className="field"><span>Quota weight (replies, 0 = same as prompts)</span>
              <input type="number" min="0" max="100" step="0.1" value={draft.outputQuotaWeight ?? 0} onChange={(event) => edit('outputQuotaWeight', event.target.value)} />
            </label>
            <label className="field"><span>Rate factor (0.05 to 1)</span>
              <input type="number" min="0.05" max="1" step="0.05" value={draft.rateFactor} onChange={(event) => edit('rateFactor', event.target.value)} />
            </label>
            <label className="field"><span>Lowest plan allowed</span>
              <select value={draft.minPlan} onChange={(event) => edit('minPlan', event.target.value)}>
                {overview.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Order in the list</span>
              <input type="number" step="1" value={draft.sortOrder} onChange={(event) => edit('sortOrder', event.target.value)} />
            </label>
          </div>
          <label className="admin-check">
            <input type="checkbox" checked={draft.isActive} onChange={(event) => edit('isActive', event.target.checked)} />
            <span>Available to customers</span>
          </label>
          <div className="card-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save model'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}

      <article className="card">
        <p className="stat-label">Plans and limits</p>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Price</th>
                <th>Monthly tokens</th>
                <th>Requests per minute</th>
                <th>At once</th>
                <th>Subscribers</th>
              </tr>
            </thead>
            <tbody>
              {overview.plans.map((plan) => (
                <tr key={plan.code}>
                  <td>{plan.name}</td>
                  <td>{formatNaira(plan.amountKobo)}</td>
                  <td>{formatTokens(plan.monthlyTokens)}</td>
                  <td>{plan.limits ? formatTokens(plan.limits.requestsPerMinute) : '-'}</td>
                  <td>{plan.limits ? formatTokens(plan.limits.maxConcurrent) : '-'}</td>
                  <td>{formatTokens(plan.subscribers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
