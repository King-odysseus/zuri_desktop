import { InlineAlert, UsageBar } from './ui.jsx';

/** A label/value line used by every dashboard table. */
export function DataRow({ label, children }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="row-meta">{children}</span>
    </div>
  );
}

/**
 * Token allowance bar. HeroUI's ProgressBar supplies role="progressbar" and
 * aria-valuenow, and the warning colour takes over near the limit, so the dashboards
 * and the account page report the same figure the same way.
 */
export function ProgressBar({ percent, warn }) {
  return <UsageBar percent={percent} warn={warn} />;
}

/** Inline status messages: warning by default, danger when the limit is gone. */
export function Alert({ tone = 'warning', children }) {
  return <InlineAlert tone={tone}>{children}</InlineAlert>;
}
