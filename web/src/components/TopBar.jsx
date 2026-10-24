import { LogoMark, MoonIcon, SunIcon } from './Icons.jsx';
import { themeLabel } from '../lib/theme.js';

/**
 * The bar spans the whole window; only its inner row is capped, so no bare
 * strip appears beside it on a wide screen.
 */
export default function TopBar({ theme, onToggleTheme, signedIn, onSignIn, onSignOut }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/" aria-label="Zuri Cloud home">
          <span className="brand-mark">
            <LogoMark />
          </span>
          <span className="brand-name">Zuri Cloud</span>
        </a>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={themeLabel(theme)}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          {signedIn ? (
            <button type="button" className="btn btn-ghost" onClick={onSignOut}>
              Sign out
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
