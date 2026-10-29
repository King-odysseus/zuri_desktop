import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/DataRow.jsx';
import { fetchAdminOverview, saveAdminModel } from '../lib/api.js';
import AdminModels from './AdminModels.jsx';
import AdminPeople from './AdminPeople.jsx';
import AdminPlans from './AdminPlans.jsx';
import AdminStats from './AdminStats.jsx';

const WINDOWS = [7, 30, 90];
const BLANK_MODEL = Object.freeze({ code: '', name: '', supplier: 'deepseek', supplierModel: '', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, imageQuality: '', inputUsdPerMillion: 0, outputUsdPerMillion: 0, quotaWeight: 1, outputQuotaWeight: 0, minPlan: 'starter', rateFactor: 1, isActive: true, sortOrder: 100 });
const NUMBER_FIELDS = ['inputUsdPerMillion', 'outputUsdPerMillion', 'usdPerImage', 'quotaTokensPerImage', 'quotaWeight', 'outputQuotaWeight', 'rateFactor', 'sortOrder'];

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
      if (failure.status === 401) setError('Your sign-in has expired. Sign in again, then open Admin.');
      else if (failure.status === 403) setError('This account is not marked as a Zuri administrator. Sign out and sign in with the administrator account.');
      else setError(failure.message);
    }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  function edit(field, value) { setSaved(''); setDraft((current) => ({ ...current, [field]: value })); }
  async function save(event) { event.preventDefault(); setBusy(true); setSaved(''); try { const model = { ...draft }; for (const field of NUMBER_FIELDS) model[field] = Number(model[field]); await saveAdminModel(model); setDraft(null); setSaved(`${model.name} saved.`); await load(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }
  if (error && !overview) return <section className="view calm admin-view"><div className="view-head"><div><h1>Admin</h1></div></div><Alert tone="danger">{error}</Alert></section>;
  if (!overview) return <section className="view calm admin-view"><div className="view-head"><div><h1>Admin</h1></div></div><div className="skeleton" role="status" aria-label="Loading the admin report" /></section>;
  return (
    <section className="view calm calm-wide admin-view">
      <div className="view-head"><div><h1>Admin</h1><p>A quiet control room for people, models, pricing and platform health.</p></div><label className="field admin-window"><span>Period</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{WINDOWS.map((value) => <option key={value} value={value}>Last {value} days</option>)}</select></label></div>
      {error && <Alert tone="danger">{error}</Alert>}{saved && <Alert>{saved}</Alert>}{overview.marginKobo < 0 && <Alert tone="danger">Supplier spend is higher than revenue for this period. Review the quota weights and plan prices.</Alert>}
      <AdminStats overview={overview} rate={overview.nairaPerUsd} />
      <AdminPeople days={days} plans={overview.plans} />
      <AdminModels overview={overview} rate={overview.nairaPerUsd} draft={draft} busy={busy} onAdd={() => { setSaved(''); setDraft({ ...BLANK_MODEL }); }} onEdit={edit} onSave={save} onCancel={() => setDraft(null)} onEditModel={(model) => { setSaved(''); setDraft({ ...model }); }} />
      <AdminPlans plans={overview.plans} />
    </section>
  );
}
