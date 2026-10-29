import { forwardRef, useId } from 'react';
import { Badge, Button as FlowbiteButton, Checkbox as FlowbiteCheckbox, Datepicker, Label, Select as FlowbiteSelect, TextInput, Textarea as FlowbiteTextarea } from 'flowbite-react';

const BUTTON_COLORS = {
  primary: 'blue',
  secondary: 'gray',
  danger: 'failure',
  ghost: 'light',
};

// Flowbite's own badge palette, kept in step with the tones the app uses. The
// zuri-chip rules paint over these classes, but a tone with no entry here would
// still hand the badge a grey border and text underneath them.
const BADGE_COLORS = {
  primary: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'failure',
};

// The chip contract has four tone classes: primary, success, warning and danger.
// A tone outside that set emitted a class no stylesheet rule matched, so it fell
// back to Flowbite's grey; every chip now resolves through this map, and `default`
// is only another name for the primary tint.
const CHIP_TONES = {
  default: 'primary',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const FIELD_CLASSES = 'zuri-field w-full rounded-xl border-0 bg-transparent p-3 text-sm text-foreground shadow-none focus:border-0 focus:ring-0 placeholder:text-muted';
const FIELD_LABEL_CLASSES = 'zuri-field-label mb-2 block text-sm font-medium text-foreground';

function fieldId(label, id, fallback) {
  const generatedId = useId();
  return id ?? (label ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId.replace(/:/g, '')}` : fallback);
}

export function Button({ variant = 'default', size, isIconOnly = false, fullWidth = false, isDisabled = false, onPress, className = '', children, ...props }) {
  const color = BUTTON_COLORS[variant] ?? 'gray';
  // Flowbite builds a button from its `size` prop (40px tall at the default, with
  // 20px of side padding), and the page rule in app.css lifts that to 44px, so every
  // desktop button read oversized. Buttons now take the style guide's compact scale:
  // 36px tall, 16px of side padding, and square when icon-only. A caller that sets its
  // own height or width keeps it, which is why the chat row actions at h-7 and the
  // composer's send button are untouched. The trailing `!` is needed because the page
  // rule in app.css is more specific than a utility class.
  const sizedByCaller = /(?:h|min-h|w|min-w|size)-/.test(className);
  const compact = sizedByCaller ? '' : 'h-9 min-h-9!';
  const compactSquare = isIconOnly && !sizedByCaller ? 'w-9 min-w-9!' : '';
  const classes = [
    'zuri-button rounded-xl',
    isIconOnly ? 'is-icon-only p-2' : 'px-4',
    compact,
    compactSquare,
    fullWidth ? 'w-full' : '',
    variant === 'primary' ? 'zuri-button-primary' : '',
    variant === 'danger' ? 'zuri-button-danger' : '',
    variant === 'secondary' ? 'zuri-button-secondary' : '',
    variant === 'secondary' ? 'zuri-selected-pill' : '',
    variant === 'ghost' ? 'zuri-button-ghost border-0 bg-transparent shadow-none' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <FlowbiteButton
      color={color}
      size={size}
      disabled={isDisabled}
      onClick={onPress}
      className={classes}
      {...props}
    >
      {children}
    </FlowbiteButton>
  );
}

export function Checkbox({ isSelected = false, onChange, isDisabled = false, className = '', children, ...props }) {
  return (
    <label className={`flex items-center gap-2 text-sm text-foreground ${className}`}>
      <FlowbiteCheckbox
        className="zuri-checkbox"
        checked={isSelected}
        disabled={isDisabled}
        onChange={(event) => onChange?.(event.target.checked)}
        {...props}
      />
      {children && <span>{children}</span>}
    </label>
  );
}

export function Chip({ color = 'default', size, className = '', children, ...props }) {
  const tone = CHIP_TONES[color] ?? 'primary';
  return <Badge color={BADGE_COLORS[tone] ?? 'info'} size={size} className={`zuri-chip zuri-chip-${tone} rounded-full ${className}`.trim()} {...props}>{children}</Badge>;
}

export function Input({ label, id, isReadOnly = false, isDisabled = false, fullWidth = false, className = '', ...props }) {
  const inputId = fieldId(label, id, undefined);
  return (
    <div className={`zuri-field-wrap ${fullWidth ? 'w-full' : ''} ${className}`.trim()}>
      {label && <Label htmlFor={inputId} className={FIELD_LABEL_CLASSES}>{label}</Label>}
      <TextInput id={inputId} readOnly={isReadOnly} disabled={isDisabled} sizing="md" className={`${FIELD_CLASSES} zuri-input`} {...props} />
    </div>
  );
}

function dateValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDateValue(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// Datepicker's own `label` prop is only placeholder text, so the visible label
// comes from the same Label the other fields use.
export function DateField({ label, value, onChange, className = '', ...props }) {
  const dateInputId = fieldId(label, undefined, undefined);
  return (
    <div className={`zuri-field-wrap ${className}`.trim()}>
      {label && <Label htmlFor={dateInputId} className={FIELD_LABEL_CLASSES}>{label}</Label>}
      <Datepicker
        id={dateInputId}
        placeholder={label}
        value={dateValue(value)}
        onChange={(next) => onChange?.(localDateValue(next))}
        className="zuri-datepicker zuri-calendar-field"
        {...props}
      />
    </div>
  );
}

export const ComposerTextarea = forwardRef(function ComposerTextarea({ className = '', ...props }, ref) {
  return <FlowbiteTextarea ref={ref} className={`composer-textarea resize-none overflow-x-hidden border-0 bg-transparent text-foreground shadow-none placeholder:text-muted ${className}`} {...props} />;
});

export function Textarea({ label, id, isDisabled = false, className = '', ...props }) {
  const textareaId = fieldId(label, id, undefined);
  return (
    <div className={`zuri-field-wrap ${className}`.trim()}>
      {label && <Label htmlFor={textareaId} className={FIELD_LABEL_CLASSES}>{label}</Label>}
      <FlowbiteTextarea id={textareaId} disabled={isDisabled} className={`${FIELD_CLASSES} zuri-textarea`} {...props} />
    </div>
  );
}

export function Select({ className = '', ...props }) {
  return <FlowbiteSelect className={`zuri-select rounded-xl ${className}`.trim()} {...props} />;
}

export { Label };
