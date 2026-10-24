import { Alert as FlowbiteAlert, Progress } from 'flowbite-react';

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
 * Token allowance bar. Flowbite supplies role="progressbar" and aria-valuenow;
 * the site's bar classes paint it, and is-warning takes over near the limit.
 */
export function ProgressBar({ percent, warn }) {
  const value = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return (
    <Progress
      progress={value}
      textLabel={`usage ${value}%`}
      theme={{ base: 'bar', bar: 'bar-fill', color: { accent: warn ? 'is-warning' : '' } }}
      color="accent"
    />
  );
}

/** Inline status messages: warning by default, danger when the limit is gone. */
export function Alert({ tone = 'warning', children }) {
  if (!children) return null;
  return (
    <FlowbiteAlert
      color={tone === 'danger' ? 'failure' : 'warning'}
      className={`alert${tone === 'danger' ? ' is-danger' : ''}`}
      role="status"
    >
      {children}
    </FlowbiteAlert>
  );
}
