import { LogoMark, MoonIcon, SunIcon } from './Icons.jsx';
import { Button } from './ui.jsx';
import { themeLabel } from '../lib/theme.js';

/**
 * The public pages' bar. It spans the whole window and only its inner row is
 * capped, so no bare strip appears beside it on a wide screen.
 *
 * The signed-in shell does not draw it: the app names itself in its own sidebar
 * and carries the theme switch and sign out there, which is the shape the desktop
 * app and the design file both use.
 *
 * @param {{
 *   theme: 'dark' | 'light',
 *   onToggleTheme: () => void,
 *   signedIn: boolean,
 *   onSignIn: () => void,
 *   onNavigate: (path: string) => void,
 * }} props
 */
export default function TopBar({ theme, onToggleTheme, signedIn, onSignIn, onNavigate }) {
  if (signedIn) return null;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="brand" onClick={() => onNavigate('/')} aria-label="Zuri Cloud home">
          <span className="brand-mark">
            <LogoMark size={20} />
          </span>
          <span className="brand-name">Zuri Cloud</span>
        </button>

        <nav className="topbar-nav" aria-label="Page sections">
          <a href="#features" onClick={(event) => { event.preventDefault(); onNavigate('/#features'); }}>
            Features
          </a>
          <a href="#how" onClick={(event) => { event.preventDefault(); onNavigate('/#how'); }}>
            How it works
          </a>
          <a href="#pricing" onClick={(event) => { event.preventDefault(); onNavigate('/#pricing'); }}>
            Pricing
          </a>
        </nav>

        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={themeLabel(theme)}
            title={themeLabel(theme)}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <Button variant="ghost" className="topbar-signin" onClick={onSignIn}>
            Sign in
          </Button>
          <Button onClick={() => onNavigate('/signup')}>Get started</Button>
        </div>
      </div>
    </header>
  );
}
