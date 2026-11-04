import { formatNaira, formatTokens } from '../lib/format.js';
import { Button, Checkbox, Input, Select } from '../components/ui.jsx';

const SUPPLIERS = ['deepseek', 'moonshot', 'zai', 'openai', 'anthropic'];

function nairaPerMillion(usd, rate) {
  return formatNaira(Math.round(Number(usd) * Number(rate) * 100));
}

function pictureMarginKobo(model) {
  return (Number(model?.priceKoboPerImage) || 0) - (Number(model?.supplierCostKoboPerImage) || 0);
}

function ModelForm({ draft, plans, busy, onEdit, onSave, onCancel, isExisting }) {
  return (
    <form className="admin-form" onSubmit={onSave}>
      <div className="admin-section-heading"><div><h2>{isExisting ? `Edit ${draft.name}` : 'New model'}</h2><p>Keep customer names separate from private supplier details.</p></div></div>
      <div className="admin-fields">
        <label className="field"><span>Code</span><Input value={draft.code} onChange={(event) => onEdit('code', event.target.value)} placeholder="zuri-flash" required /></label>
        <label className="field"><span>Name customers see</span><Input value={draft.name} onChange={(event) => onEdit('name', event.target.value)} placeholder="Zuri Flash" maxLength={40} required /></label>
        <label className="field"><span>Supplier (private)</span><Select value={draft.supplier} onChange={(event) => onEdit('supplier', event.target.value)}>{SUPPLIERS.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}</Select></label>
        <label className="field"><span>Supplier model name</span><Input value={draft.supplierModel} onChange={(event) => onEdit('supplierModel', event.target.value)} required /></label>
        <label className="field"><span>Billed as</span><Select value={draft.kind ?? 'text'} onChange={(event) => onEdit('kind', event.target.value)}><option value="text">Chat, by the token</option><option value="image">Pictures, by the image</option></Select></label>
        {draft.kind !== 'image' ? <>
          <label className="field"><span>Input price, USD per 1M tokens</span><Input type="number" min="0" step="0.01" value={draft.inputUsdPerMillion} onChange={(event) => onEdit('inputUsdPerMillion', event.target.value)} /></label>
          <label className="field"><span>Output price, USD per 1M tokens</span><Input type="number" min="0" step="0.01" value={draft.outputUsdPerMillion} onChange={(event) => onEdit('outputUsdPerMillion', event.target.value)} /></label>
        </> : <>
          <label className="field"><span>Supplier price, USD per picture</span><Input type="number" min="0" step="0.001" value={draft.usdPerImage} onChange={(event) => onEdit('usdPerImage', event.target.value)} /></label>
          <label className="field"><span>Allowance tokens per picture</span><Input type="number" min="1000" max="4000000" step="1000" value={draft.quotaTokensPerImage} onChange={(event) => onEdit('quotaTokensPerImage', event.target.value)} /></label>
          <label className="field"><span>Picture size label</span><Input value={draft.imageQuality ?? ''} maxLength={20} onChange={(event) => onEdit('imageQuality', event.target.value)} placeholder="standard" /></label>
        </>}
        <label className="field"><span>Quota weight (prompts)</span><Input type="number" min="0.1" max="100" step="0.1" value={draft.quotaWeight} onChange={(event) => onEdit('quotaWeight', event.target.value)} /></label>
        <label className="field"><span>Quota weight (replies, 0 = same as prompts)</span><Input type="number" min="0" max="100" step="0.1" value={draft.outputQuotaWeight ?? 0} onChange={(event) => onEdit('outputQuotaWeight', event.target.value)} /></label>
        <label className="field"><span>Rate factor (0.05 to 1)</span><Input type="number" min="0.05" max="1" step="0.05" value={draft.rateFactor} onChange={(event) => onEdit('rateFactor', event.target.value)} /></label>
        <label className="field"><span>Lowest plan allowed</span><Select value={draft.minPlan} onChange={(event) => onEdit('minPlan', event.target.value)}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</Select></label>
        <label className="field"><span>Order in the list</span><Input type="number" step="1" value={draft.sortOrder} onChange={(event) => onEdit('sortOrder', event.target.value)} /></label>
      </div>
      <Checkbox className="admin-check" checked={draft.isActive} onChange={(event) => onEdit('isActive', event.target.checked)}><span>Available to customers</span></Checkbox>
      <div className="card-actions"><Button type="submit" className="btn btn-primary" variant="primary" isDisabled={busy}>{busy ? 'Saving' : 'Save model'}</Button><Button type="button" className="btn btn-ghost" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

export default function AdminModels({ overview, rate, draft, busy, onAdd, onEdit, onSave, onCancel, onEditModel }) {
  const spendByCode = new Map(overview.spendByModel.map((row) => [row.modelCode, row]));
  return (
    <>
      <section className="admin-section">
        <div className="admin-section-heading"><div><h2>Models and prices</h2><p>What customers see, what suppliers charge, and how each model uses allowance.</p></div><Button type="button" className="btn btn-secondary" variant="secondary" onClick={onAdd}>Add a model</Button></div>
        <div className="admin-scroll"><table className="admin-table admin-models-table"><thead><tr><th>Zuri name</th><th>Supplier</th><th>Plan</th><th>Weight</th><th>Rate</th><th>Supplier cost</th><th>Requests</th><th>Spend</th><th><span className="sr-only">Edit</span></th></tr></thead><tbody>
          {overview.models.map((model) => { const spend = spendByCode.get(model.code); return <tr key={model.code} className={model.isActive ? '' : 'is-off'}><td>{model.name}<small>{model.code}{model.isActive ? '' : ' (off)'}</small></td><td>{model.supplier}<small>{model.supplierModel}</small></td><td>{model.minPlan}</td><td>{model.quotaWeight}x<small>replies {(model.outputQuotaWeight > 0 ? model.outputQuotaWeight : model.quotaWeight)}x</small></td><td>{Math.round(model.rateFactor * 100)}%</td><td>{model.kind === 'image' ? <>{formatNaira(model.supplierCostKoboPerImage)}<small>sells at {formatNaira(model.priceKoboPerImage)} on {model.pricePlanName}</small><small>margin {formatNaira(pictureMarginKobo(model))} a picture</small></> : <>in {nairaPerMillion(model.inputUsdPerMillion, rate)}<small>out {nairaPerMillion(model.outputUsdPerMillion, rate)}</small></>}</td><td>{formatTokens(spend?.requests ?? 0)}</td><td>{formatNaira(spend?.costKobo ?? 0)}</td><td><Button type="button" className="btn btn-ghost" variant="ghost" onClick={() => onEditModel(model)}>Edit</Button></td></tr>; })}
        </tbody></table></div>
        <p className="admin-help">Weight controls how quickly a model uses a customer's allowance. Rate is the share of requests per minute it receives.</p>
      </section>
      {draft && <ModelForm draft={draft} plans={overview.plans} busy={busy} onEdit={onEdit} onSave={onSave} onCancel={onCancel} isExisting={overview.models.some((model) => model.code === draft.code)} />}
    </>
  );
}
