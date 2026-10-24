import { Alert, Badge, Button as FlowbiteButton, Progress } from 'flowbite-react';

/**
 * Flowbite React for behaviour and markup, the site's own classes for the skin.
 *
 * The site stylesheet is unlayered, so it outranks Tailwind's utilities: each
 * control keeps the 44px height, 12px radius and accent colours the rest of the
 * page already uses, while Flowbite supplies the semantics (a real progressbar
 * with aria-valuenow, a dismissible alert, a badge) instead of hand-rolled divs.
 */

const VARIANTS = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  outline: 'btn btn-outline',
  ghost: 'btn btn-ghost',
};

export function Button({ variant = 'primary', block = false, className = '', ...props }) {
  const classes = [VARIANTS[variant] ?? VARIANTS.primary, block ? 'btn-block' : '', className]
    .filter(Boolean)
    .join(' ');
  return <FlowbiteButton className={classes} color="gray" {...props} />;
}

/** A pill label: the plan tile's "Current plan", the hero's eyebrow and the preview chip. */
export function Chip({ tone = 'default', className = '', children }) {
  return (
    <Badge color="gray" className={`chip${tone === 'accent' ? ' chip-accent' : ''} ${className}`.trim()}>
      {children}
    </Badge>
  );
}

/**
 * Token allowance bar. Flowbite gives the element role="progressbar" and
 * aria-valuenow; the bar classes come from the site so the fill colour and the
 * warning state stay in one place.
 */
export function UsageBar({ percent, warn = false, label = 'usage' }) {
  const value = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return (
    <Progress
      progress={value}
      textLabel={`${label} ${value}%`}
      theme={{
        base: 'bar',
        bar: 'bar-fill',
        color: { accent: warn ? 'is-warning' : '' },
      }}
      color="accent"
    />
  );
}

/** A status line: a payment confirmation, or an error worth reading twice. */
export function Notice({ kind = 'info', children }) {
  if (!children) return null;
  const colour = kind === 'error' ? 'failure' : kind === 'success' ? 'success' : 'gray';
  const tone = kind === 'error' ? 'is-error' : kind === 'success' ? 'is-success' : '';
  return (
    <Alert color={colour} className={`notice ${tone}`.trim()} role="status">
      {children}
    </Alert>
  );
}

/** Inline dashboard warning, the same alert component with the page's own tone. */
export function InlineAlert({ tone = 'warning', children }) {
  if (!children) return null;
  return (
    <Alert
      color={tone === 'danger' ? 'failure' : 'warning'}
      className={`alert${tone === 'danger' ? ' is-danger' : ''}`}
      role="status"
    >
      {children}
    </Alert>
  );
}
