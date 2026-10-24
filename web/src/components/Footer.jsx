import { LogoMark } from './Icons.jsx';
import DownloadLink from './DownloadLink.jsx';

/**
 * One footer for every page. "Powered by Tijha" is plain text on purpose:
 * there is no Tijha site address in this project to link to, and a guessed
 * domain is worse than no link.
 *
 * @param {{ compact?: boolean }} props
 */
export default function Footer({ compact = false }) {
  return (
    <footer className={compact ? 'foot foot-compact' : 'foot'}>
      <span className="foot-brand">
        <LogoMark size={22} />
        <span>Zuri Cloud</span>
      </span>
      {!compact && <span>The online half of the Zuri desktop app. Payments by Paystack, prices in Naira.</span>}
      <DownloadLink />
      <span className="foot-powered">
        Powered by <strong>Tijha</strong>
      </span>
    </footer>
  );
}
