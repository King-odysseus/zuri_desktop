import Footer from '../components/Footer.jsx';
import GoogleSignIn from '../components/GoogleSignIn.jsx';
import { Button } from '../components/ui.jsx';
import { BoltIcon, BrainIcon, CheckIcon, GlobeIcon, LockIcon, LogoMark } from '../components/Icons.jsx';

const COPY = {
  signin: {
    eyebrow: 'Welcome back',
    title: 'Sign in to Zuri Cloud',
    lead: 'Pick up your plan, your usage and your billing exactly where you left them.',
    switchText: 'New to Zuri Cloud?',
    switchLabel: 'Create an account',
    switchHref: '/signup',
  },
  signup: {
    eyebrow: 'Get started',
    title: 'Create your Zuri Cloud account',
    lead: 'Your account is created the first time you continue with Google. One sign-in covers this dashboard and the desktop app.',
    switchText: 'Already have an account?',
    switchLabel: 'Sign in',
    switchHref: '/signin',
  },
};

const BENEFITS = [
  { icon: <CheckIcon />, text: 'The free plan starts with 100,000 tokens every month.' },
  { icon: <CheckIcon />, text: 'Company, school and custom-domain Google accounts work too.' },
  { icon: <CheckIcon />, text: 'Same quota and history on the desktop app and in the browser.' },
];

const TRUST = [
  { icon: <LockIcon />, label: 'Google verified' },
  { icon: <GlobeIcon />, label: 'Works on any device' },
  { icon: <BoltIcon />, label: 'Naira billing' },
];

/**
 * The two account screens. They share one layout because they share one method:
 * Google is the only sign-in this server offers, so a second form field would
 * promise something that cannot work.
 *
 * @param {{
 *   mode: 'signin' | 'signup',
 *   theme: 'dark' | 'light',
 *   onCredential: (credential: string) => Promise<void>,
 *   onError: (message: string) => void,
 *   onNavigate: (path: '/' | '/signin' | '/signup') => void,
 * }} props
 */
export default function AuthView({ mode, theme, onCredential, onError, onNavigate }) {
  const copy = COPY[mode] ?? COPY.signin;

  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <div className="auth-aside-inner">
          <button type="button" className="brand auth-brand" onClick={() => onNavigate('/')}>
            <span className="brand-mark">
              <LogoMark size={20} />
            </span>
            <span className="brand-name">Zuri Cloud</span>
          </button>
          <h1>
            {mode === 'signup' ? 'Your AI command centre, in the cloud.' : 'Good to see you again.'}
          </h1>
          <p>
            {mode === 'signup'
              ? 'One account for the assistant on your desktop and this dashboard. Start free, move up a plan when the work grows.'
              : 'Your threads, your files and your plan are waiting on the other side of this button.'}
          </p>
          <ul className="auth-trust">
            {TRUST.map((item) => (
              <li key={item.label}>
                {item.icon}
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-switch" role="tablist" aria-label="Account action">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`auth-switch-btn${mode === 'signin' ? ' is-active' : ''}`}
              onClick={() => onNavigate('/signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-switch-btn${mode === 'signup' ? ' is-active' : ''}`}
              onClick={() => onNavigate('/signup')}
            >
              Create account
            </button>
          </div>

          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p className="auth-lead">{copy.lead}</p>

          <GoogleSignIn theme={theme} onCredential={onCredential} onError={onError} />

          <ul className="auth-benefits">
            {BENEFITS.map((item) => (
              <li key={item.text}>
                {item.icon}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>

          <p className="auth-switch-line">
            {copy.switchText}{' '}
            <a
              href={copy.switchHref}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(copy.switchHref);
              }}
            >
              {copy.switchLabel}
            </a>
          </p>

          <p className="auth-terms">
            By continuing you agree to Zuri Cloud keeping your account, usage and payment records so the
            dashboard can show them. Zuri never posts to your Google account.
          </p>

          <Button variant="ghost" block className="auth-back" onClick={() => onNavigate('/')}>
            Back to home
          </Button>
        </div>

        <div className="auth-meta">
          <span><BrainIcon /> Zuri learns your answer style, not your secrets.</span>
        </div>
        <Footer compact />
      </section>
    </main>
  );
}
