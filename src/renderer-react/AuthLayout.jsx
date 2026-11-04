import zuriMarkUrl from './assets/zuri-logo.png';
import authTeamUrl from './assets/auth-team.jpg';

/**
 * The one composition behind every account screen in the installed app: the
 * photograph panel, then a single card in the narrow rail beside it.
 *
 * The shell wears data-theme="light" on purpose. These screens are the first
 * thing anyone sees, the web account page is bright, and the saved theme is not
 * known until settings have loaded, so the entry screens would otherwise open on
 * the dark canvas and then stay dark for everyone who chose it. The attribute
 * re-declares the light tokens for this subtree only: everything inside reads
 * light, and the rest of the app keeps whatever theme was chosen.
 *
 * @param {{
 *   aside?: { eyebrow: string, headline: string, copy: string } | null,
 *   meta?: string,
 *   footer?: boolean,
 *   className?: string,
 *   children: React.ReactNode,
 * }} props
 */
export default function AuthLayout({ aside = null, meta = '', footer = false, className = '', children }) {
  return (
    <main
      className={`zuri-auth-page bg-background text-foreground${aside ? '' : ' is-solo'}${className ? ` ${className}` : ''}`}
      data-theme="light"
    >
      {aside && (
        <aside className="zuri-auth-aside" style={{ '--zuri-auth-image': `url(${authTeamUrl})` }}>
          <a className="zuri-auth-brand" href="https://zuri.tijha.com" aria-label="Zuri Cloud home">
            <span className="zuri-auth-brand-mark"><img src={zuriMarkUrl} alt="" width="24" height="24" decoding="async" /></span>
            <span>Zuri Cloud</span>
          </a>
          <div className="zuri-auth-aside-copy">
            <span className="zuri-auth-eyebrow">{aside.eyebrow}</span>
            <h1>{aside.headline}</h1>
            <p>{aside.copy}</p>
            <ul className="zuri-auth-trust" aria-label="Zuri benefits">
              <li>Encrypted in transit</li>
              <li>Works on any device</li>
              <li>Naira billing</li>
            </ul>
          </div>
        </aside>
      )}

      <section className="zuri-auth-panel">
        <div className="zuri-auth-body">
          {children}
          {meta !== '' && <p className="zuri-auth-meta">{meta}</p>}
        </div>
        {footer && <AuthFooter />}
      </section>
    </main>
  );
}

/** The same four links the web account page closes with. */
export function AuthFooter() {
  return (
    <footer className="zuri-auth-footer">
      <span>Zuri Cloud</span>
      <a href="https://zuri.tijha.com/downloads">Download for Windows</a>
      <a href="https://zuri.tijha.com/privacy">Privacy and data</a>
      <a href="https://zuri.tijha.com/terms">Terms and AI disclaimer</a>
      <small>Powered by Tijha</small>
    </footer>
  );
}
