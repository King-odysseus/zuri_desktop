import { useEffect, useRef, useState } from 'react';
import { Button, Chip } from './ui.jsx';
import { CheckIcon, CloudIcon, LogOutIcon, UserPlusIcon } from './Icons.jsx';

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
    document.head.appendChild(script);
  });
}

function dateLabel(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString();
}

export default function CloudView({ onNavigate }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const googleButtonRef = useRef(null);
  const [config, setConfig] = useState(null);
  const [account, setAccount] = useState(null);
  const [plans, setPlans] = useState([]);
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function loadAccount() {
    const result = await api?.cloud?.account?.();
    if (result?.ok) {
      setAccount(result.data);
      setStatus('ready');
      return true;
    }
    if (result?.error?.code === 'CLOUD_AUTH_REQUIRED') setStatus('signed-out');
    else {
      setStatus('error');
      setMessage(result?.error?.message ?? 'Your cloud account could not be loaded.');
    }
    return false;
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (typeof api?.cloud?.config !== 'function') {
        setStatus('error');
        setMessage('Cloud accounts are only available inside the Zuri app.');
        return;
      }
      const [configResult, plansResult] = await Promise.all([api.cloud.config(), api.cloud.plans()]);
      if (!active) return;
      if (!configResult?.ok) {
        setStatus('error');
        setMessage(configResult?.error?.message ?? 'Cloud sign-in is not configured.');
        return;
      }
      setConfig(configResult.data);
      if (plansResult?.ok) setPlans(Array.isArray(plansResult.data) ? plansResult.data : []);
      await loadAccount();
    };
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (status !== 'signed-out' || !config?.googleClientId || !googleButtonRef.current) return undefined;
    let active = true;
    void loadGoogleIdentityScript().then(() => {
      if (!active || !window.google?.accounts?.id || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (response) => { void signIn(response?.credential); },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonRef.current, { theme: 'outline', size: 'large', text: 'continue_with', width: 320 });
    }).catch((error) => {
      if (active) setMessage(error?.message ?? 'Google sign-in could not be loaded.');
    });
    return () => { active = false; };
  }, [status, config?.googleClientId]);

  async function signIn(credential) {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.cloud.signIn({ credential });
      if (!result?.ok) {
        setMessage(result?.error?.message ?? 'Google sign-in could not be completed.');
        return;
      }
      await loadAccount();
    } catch (error) {
      setMessage(error?.message ?? 'Google sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    const result = await api?.cloud?.signOut?.();
    setAccount(null);
    setStatus('signed-out');
    setMessage(result?.ok ? 'Signed out of Zuri Cloud.' : result?.error?.message ?? 'The cloud session was cleared locally.');
    setBusy(false);
  }

  async function choosePlan(planCode) {
    setBusy(true);
    setMessage('');
    const result = await api?.cloud?.checkout?.({ planCode });
    setMessage(result?.ok ? 'Checkout opened in your browser.' : result?.error?.message ?? 'Checkout could not be opened.');
    setBusy(false);
  }

  const usage = account?.usage;
  const currentPlan = account?.subscription?.planCode ?? usage?.planCode ?? 'free';

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header>
          <h1 className="text-3xl font-medium tracking-tight">Zuri Cloud</h1>
          <p className="mt-2 text-sm text-muted">Sign in to sync your account, track usage, and manage your plan.</p>
        </header>
        {message !== '' && <p role="status" className="text-sm text-muted">{message}</p>}
        {status === 'loading' && <p className="text-sm text-muted">Checking your cloud account...</p>}
        {status === 'error' && <section className="rounded-xl border border-border bg-surface p-5"><p className="text-sm">Cloud sign-in is not ready yet.</p><Button className="mt-4" variant="secondary" onPress={() => onNavigate?.('settings')}>Open Settings</Button></section>}
        {status === 'signed-out' && <section className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent"><CloudIcon size={22} /></div>
          <h2 className="mt-5 text-2xl font-medium">Continue to Zuri Cloud</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Use any verified Google account, including company, school, and custom-domain Workspace accounts. Your session is stored securely by the desktop app.</p>
          {!config?.googleClientId && <p className="mt-4 text-sm text-muted">Google sign-in is not configured on this cloud server yet.</p>}
          <div ref={googleButtonRef} className="mt-6 min-h-10" aria-label="Continue with Google" />
          {busy && <p className="mt-3 text-sm text-muted">Signing you in...</p>}
        </section>}
        {status === 'ready' && account && <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent"><UserPlusIcon size={21} /></span><div><h2 className="font-medium">{account.user?.displayName || account.user?.email}</h2><p className="text-sm text-muted">{account.user?.email}</p></div></div>
              <Button variant="ghost" onPress={() => void signOut()} isDisabled={busy}><LogOutIcon size={16} /> Sign out</Button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-muted">Plan</p><p className="mt-1 font-medium">{account.subscription?.planName ?? currentPlan}</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Renews</p><p className="mt-1 font-medium">{dateLabel(account.subscription?.currentPeriodEnd)}</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Status</p><p className="mt-1 font-medium">{account.subscription?.status ?? 'active'}</p></div></div>
          </section>
          <section className="rounded-xl border border-border bg-surface p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-medium">Usage this month</h2><p className="mt-1 text-sm text-muted">Your allowance resets at the end of the current period.</p></div><Chip color={usage?.overQuota ? 'danger' : usage?.nearLimit ? 'warning' : 'primary'}>{usage?.percentUsed ?? 0}% used</Chip></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, usage?.percentUsed ?? 0)}%` }} /></div><div className="mt-3 flex justify-between text-sm text-muted"><span>{(usage?.usedTokens ?? 0).toLocaleString()} used</span><span>{(usage?.remainingTokens ?? 0).toLocaleString()} remaining</span></div></section>
          <section className="rounded-xl border border-border bg-surface p-5"><h2 className="text-lg font-medium">Plans</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{plans.map((plan) => <div key={plan.code} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{plan.name}</h3>{plan.code === currentPlan && <Chip color="primary"><CheckIcon size={13} /> Current</Chip>}</div><p className="mt-2 text-sm text-muted">{plan.monthlyTokens.toLocaleString()} tokens / month</p><p className="mt-3 font-medium">{plan.amountKobo === 0 ? 'Free' : `NGN ${(plan.amountKobo / 100).toLocaleString()}`}</p>{plan.code !== currentPlan && plan.code !== 'free' && <Button className="mt-4" variant="secondary" fullWidth onPress={() => void choosePlan(plan.code)} isDisabled={busy}>Choose plan</Button>}</div>)}</div></section>
          <section className="rounded-xl border border-border bg-surface p-5"><h2 className="text-lg font-medium">Payment history</h2>{account.billing?.payments?.length ? <div className="mt-4 flex flex-col gap-2">{account.billing.payments.map((payment) => <div key={payment.reference} className="flex flex-wrap justify-between gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-sm"><span>{payment.plan_code} - {payment.reference}</span><span className="text-muted">{payment.status} - {dateLabel(payment.paid_at || payment.created_at)}</span></div>)}</div> : <p className="mt-2 text-sm text-muted">No payments yet.</p>}</section>
        </>}
      </div>
    </main>
  );
}
