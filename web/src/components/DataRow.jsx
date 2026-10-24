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
 * Token allowance bar. Switches to warning colours once the plan is close to,
 * or over, its limit.
 */
export function ProgressBar({ percent, warn }) {
  return (
    <div className="bar">
      <div
        className={`bar-fill${warn ? ' is-warning' : ''}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/** Inline status messages: warning by default, danger when the limit is gone. */
export function Alert({ tone = 'warning', children }) {
  if (!children) return null;
  return <div className={`alert${tone === 'danger' ? ' is-danger' : ''}`}>{children}</div>;
}
