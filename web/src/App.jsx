import { useCallback, useEffect, useMemo, useState } from 'react';
import NoticeBar from './components/NoticeBar.jsx';
import TopBar from './components/TopBar.jsx';
import Dashboard from './views/Dashboard.jsx';
import Landing from './views/Landing.jsx';
import {
  api,
  clearToken,
  createCheckout,
  fetchAccount,
  fetchPlans,
  readToken,
  saveToken,
  signOutRequest,
  verifyPayment,
} from './lib/api.js';
import { applyTheme, preferredTheme } from './lib/theme.js';

const VIEWS = ['overview', 'usage', 'plans', 'billing'];

function scrollToSignIn() {
  document.getElementById('signin-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function App() {
  const [theme, setTheme] = useState(preferredTheme);
  const [plans, setPlans] = useState([]);
  // 'booting' until the first account/plan load settles, so there is no flash
  // of the marketing page for a customer who is already signed in.
  const [status, setStatus] = useState('booting');
  const [account, setAccount] = useState(null);
  const [notice, setNotice] = useState(null);
  const [view, setView] = useState('overview');
  const [busyPlan, setBusyPlan] = useState('');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const showNotice = useCallback((message, kind = 'info') => {
    setNotice(message ? { message, kind } : null);
  }, []);

  const loadAccount = useCallback(async () => {
    const next = await fetchAccount();
    setAccount(next);
    setStatus('signed-in');
    return next;
  }, []);

  // First load: plans for the pricing table, then the session, then any
  // Paystack return reference.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const loaded = await fetchPlans();
        if (!cancelled) setPlans(loaded);
      } catch (error) {
        if (!cancelled) {
          setPlans([]);
          showNotice(error.message, 'error');
        }
      }

      const reference = new URLSearchParams(window.location.search).get('reference');
      if (reference) {
        showNotice('Confirming your payment...');
        try {
          await verifyPayment(reference);
          showNotice('Payment confirmed. Your new plan is active.', 'success');
        } catch (error) {
          showNotice(error.message, 'error');
        }
        window.history.replaceState({}, '', window.location.pathname);
      }

      if (!readToken()) {
        if (!cancelled) setStatus('signed-out');
        return;
      }

      try {
        await loadAccount();
      } catch (error) {
        if (cancelled) return;
        if (error.status === 401) {
          clearToken();
          setStatus('signed-out');
        } else {
          showNotice(error.message, 'error');
          setStatus('signed-out');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadAccount, showNotice]);

  const handleCredential = useCallback(
    async (credential) => {
      try {
        const result = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential }),
        });
        saveToken(result.token);
        showNotice(null);
        setStatus('booting');
        await loadAccount();
      } catch (error) {
        showNotice(error.message, 'error');
        setStatus('signed-out');
      }
    },
    [loadAccount, showNotice],
  );

  const handleSignOut = useCallback(async () => {
    await signOutRequest();
    clearToken();
    setAccount(null);
    setStatus('signed-out');
    setView('overview');
    showNotice(null);
    window.scrollTo({ top: 0 });
  }, [showNotice]);

  const handleChoose = useCallback(
    async (planCode) => {
      setBusyPlan(planCode);
      try {
        const url = await createCheckout(planCode);
        window.location.assign(url);
      } catch (error) {
        showNotice(error.message, 'error');
        setBusyPlan('');
      }
    },
    [showNotice],
  );

  const handleViewChange = useCallback((next) => {
    setView(VIEWS.includes(next) ? next : 'overview');
    window.scrollTo({ top: 0 });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const body = useMemo(() => {
    if (status === 'booting') {
      return (
        <main className="landing">
          <div className="skeleton-stack" aria-hidden="true" style={{ paddingTop: 48 }}>
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
          <span className="sr-only" role="status">
            Loading your account
          </span>
        </main>
      );
    }
    if (status === 'signed-in' && account) {
      return (
        <Dashboard
          account={account}
          plans={plans}
          view={view}
          busy={busyPlan}
          onViewChange={handleViewChange}
          onChoose={handleChoose}
          onSignIn={scrollToSignIn}
        />
      );
    }
    return (
      <Landing
        plans={plans}
        theme={theme}
        busy={busyPlan}
        onCredential={handleCredential}
        onError={(message) => showNotice(message, 'error')}
        onChoose={handleChoose}
        onSignIn={scrollToSignIn}
      />
    );
  }, [
    account,
    busyPlan,
    handleChoose,
    handleCredential,
    handleViewChange,
    plans,
    showNotice,
    status,
    theme,
    view,
  ]);

  return (
    <>
      <TopBar
        theme={theme}
        onToggleTheme={toggleTheme}
        signedIn={status === 'signed-in'}
        onSignIn={scrollToSignIn}
        onSignOut={handleSignOut}
      />
      <NoticeBar notice={notice} />
      {body}
    </>
  );
}
