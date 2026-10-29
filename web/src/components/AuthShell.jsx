import Footer from './Footer.jsx';
import { AgentIcon, BoltIcon, BrainIcon, GlobeIcon, LockIcon, LogoMark } from './Icons.jsx';

const TRUST = [
  { icon: <LockIcon />, label: 'Encrypted in transit' },
  { icon: <GlobeIcon />, label: 'Works on any device' },
  { icon: <BoltIcon />, label: 'Naira billing' },
];

/**
 * The frame every account screen shares: a decorative colour band on narrow
 * windows, a full column of copy beside the card on wide ones. The band carries
 * no words on a phone because the top bar already shows the brand and the card
 * holds the copy, so the small screen stays about the form. Writing the frame
 * once keeps the sign-in, forgot-password and reset-password pages in the same
 * place, so moving from one to the next does not feel like leaving the site.
 *
 * @param {{
 *   asideTitle: string,
 *   asideCopy: string,
 *   onNavigate: (path: string) => void,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function AuthShell({ asideTitle, asideCopy, onNavigate, children }) {
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <div className="auth-aside-inner">
          <button
            type="button"
            className="brand auth-brand"
            onClick={() => onNavigate('/')}
            aria-label="Zuri Cloud home"
          >
            <span className="brand-mark">
              <LogoMark size={20} />
            </span>
            <span className="brand-name">Zuri Cloud</span>
          </button>
          <span className="auth-eyebrow">
            <AgentIcon size={13} aria-hidden="true" />
            Your AI agent
          </span>
          <h1>{asideTitle}</h1>
          <p>{asideCopy}</p>
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
        {/* The card and its note share one growing column, so the footer below them
            is free to sit at the bottom edge of the window whatever the form length. */}
        <div className="auth-body">
          <div className="auth-card">{children}</div>

          <div className="auth-meta">
            <span>
              <BrainIcon /> Zuri learns your answer style, not your secrets.
            </span>
          </div>
        </div>
        <Footer compact />
      </section>
    </main>
  );
}
