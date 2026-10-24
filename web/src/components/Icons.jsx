// Inline SVG icons keep the bundle small and inherit stroke colour from CSS.
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10L7 17h10" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg {...base}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base} strokeWidth={2}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg {...base}>
      <path d="M12 3 4 7v6c0 4 3.4 6.7 8 8 4.6-1.3 8-4 8-8V7z" />
    </svg>
  );
}

export function DeviceIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function CardIcon() {
  return (
    <svg {...base}>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20M6 16h4" />
    </svg>
  );
}

export function ChartIcon() {
  return (
    <svg {...base}>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </svg>
  );
}

export function GridIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function ReceiptIcon() {
  return (
    <svg {...base}>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </svg>
  );
}
