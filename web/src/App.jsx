import { useCallback, useEffect, useMemo, useState } from 'react';
import NoticeBar from './components/NoticeBar.jsx';
import TopBar from './components/TopBar.jsx';
import AuthView from './views/AuthView.jsx';
import Dashboard from './views/Dashboard.jsx';
import ForgotPasswordView from './views/ForgotPasswordView.jsx';
import Landing from './views/Landing.jsx';
import LegalView from './views/LegalView.jsx';
import ResetPasswordView from './views/ResetPasswordView.jsx';
import {
  api,
  clearToken,
  createCheckout,
  fetchAccount,
  fetchPlans,
  readToken,
  saveToken,
  signInWithPassword,
  signOutRequest,
  signUpWithPassword,
  verifyPayment,
} from './lib/api.js';
import { applyTheme, preferredTheme } from './lib/theme.js';

const VIEWS = ['overview', 'usage', 'plans', 'billing', 'account', 'admin'];
const LEGAL_PATHS = ['/privacy', '/terms'];
const AUTH_PATHS = ['/signin', '/signup', '/forgot-password', '/reset-password', ...LEGAL_PATHS];

/**
 * The public addresses. Everything else is the landing page, so a stale link or
 * a typo lands somewhere useful instead of a blank shell.
 * @returns {{ path: string, hash: string }}
 */
function readRoute() {
  const raw = window.location.pathname.replace(/\/+$/, '') || '/';
  return {
    path: AUTH_PATHS.includes(raw) ? raw : '/',
    hash: window.location.hash ?? '',
  };
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
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Back and forward move between the landing page and the account screens.
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next) => {
    const [rawPath, rawHash = ''] = String(next).split('#');
    const path = AUTH_PATHS.includes(rawPath) ? rawPath : '/';
    window.history.pushState({}, '', `${path}${rawHash ? `#${rawHash}` : ''}`);
    setRoute({ path, hash: rawHash ? `#${rawHash}` : '' });
  }, []);

  // Scrolling belongs to the route, not to the click: the section has to exist
  // in the DOM first, which only happens after this render commits.
  useEffect(() => {
    if (route.hash) {
      document.getElementById(route.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    window.scrollTo({ top: 0 });
  }, [route]);

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
        // Straight to the dashboard; the sign-in screen has done its job.
        window.history.replaceState({}, '', '/');
        setRoute({ path: '/', hash: '' });
      } catch (error) {
        showNotice(error.message, 'error');
        setStatus('signed-out');
      }
    },
    [loadAccount, showNotice],
  );

  const handlePasswordSignIn = useCallback(
    async ({ mode, email, password, displayName }) => {
      const result =
        mode === 'signup'
          ? await signUpWithPassword({ email, password, displayName })
          : await signInWithPassword({ email, password });
      // The Google route answers with { token, user }. Reading a nested session
      // as well costs nothing and keeps the form working if the server wraps it.
      const token = result?.token ?? result?.session?.token ?? '';
      if (!token) throw new Error('The server did not send a session back. Try again.');
      saveToken(token);
      showNotice(null);
      setStatus('booting');
      try {
        await loadAccount();
      } catch (error) {
        // A token that cannot load an account is no use; drop it so the form is
        // still the thing on screen. The form unmounted while the skeleton was
        // up, so the reason goes to the status bar rather than under the fields.
        clearToken();
        setStatus('signed-out');
        showNotice('You signed in, but your account could not be loaded. Try again in a moment.', 'error');
        throw error;
      }
      window.history.replaceState({}, '', '/');
      setRoute({ path: '/', hash: '' });
    },
    [loadAccount, showNotice],
  );

  /** @param {string} [nextPath] Where to land afterwards; the account screens send people to sign in. */
  const handleSignOut = useCallback(
    async (nextPath = '/') => {
      await signOutRequest();
      clearToken();
      setAccount(null);
      setStatus('signed-out');
      setView('overview');
      showNotice(null);
      navigate(typeof nextPath === 'string' ? nextPath : '/');
    },
    [navigate, showNotice],
  );

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

  const handleSignIn = useCallback(() => navigate('/signin'), [navigate]);

  const body = useMemo(() => {
    // The two password links are reached from an email, so they render whatever
    // the session state is: a signed-in person holding a reset link still gets
    // the form instead of being bounced into the dashboard.
    if (LEGAL_PATHS.includes(route.path)) {
      return <LegalView path={route.path} onNavigate={navigate} />;
    }
    if (route.path === '/forgot-password') {
      return <ForgotPasswordView onNavigate={navigate} signedIn={status === 'signed-in'} />;
    }
    if (route.path === '/reset-password') {
      return (
        <ResetPasswordView
          onNavigate={navigate}
          onNotify={showNotice}
          signedIn={status === 'signed-in'}
        />
      );
    }
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
          onSignIn={handleSignIn}
          onSignOut={() => handleSignOut('/signin')}
        />
      );
    }
    if (route.path === '/signin' || route.path === '/signup') {
      return (
        <AuthView
          mode={route.path === '/signup' ? 'signup' : 'signin'}
          theme={theme}
          onCredential={handleCredential}
          onPasswordSignIn={handlePasswordSignIn}
          onError={(message) => showNotice(message, 'error')}
          onNavigate={navigate}
        />
      );
    }
    return (
      <Landing
        plans={plans}
        busy={busyPlan}
        onChoose={handleChoose}
        onNavigate={navigate}
      />
    );
  }, [
    account,
    busyPlan,
    handleChoose,
    handleCredential,
    handlePasswordSignIn,
    handleSignIn,
    handleSignOut,
    handleViewChange,
    navigate,
    plans,
    route.path,
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
        onSignIn={handleSignIn}
        onSignOut={() => handleSignOut('/')}
        onNavigate={navigate}
      />
      <NoticeBar notice={notice} />
      {body}
    </>
  );
}
