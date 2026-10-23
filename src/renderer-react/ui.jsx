import { forwardRef, useId } from 'react';
import { Badge, Button as FlowbiteButton, Checkbox as FlowbiteCheckbox, Datepicker, Label, Select as FlowbiteSelect, TextInput, Textarea as FlowbiteTextarea } from 'flowbite-react';

const BUTTON_COLORS = {
  primary: 'blue',
  secondary: 'gray',
  danger: 'failure',
  ghost: 'light',
};

const BADGE_COLORS = {
  primary: 'info',
  danger: 'failure',
  default: 'gray',
  warning: 'warning',
};

const FIELD_CLASSES = 'zuri-field w-full rounded-xl border-0 bg-transparent p-3 text-sm text-foreground shadow-none focus:border-0 focus:ring-0 placeholder:text-muted';
const FIELD_LABEL_CLASSES = 'zuri-field-label mb-2 block text-sm font-medium text-foreground';

function fieldId(label, id, fallback) {
  const generatedId = useId();
  return id ?? (label ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId.replace(/:/g, '')}` : fallback);
}

export function Button({ variant = 'default', size, isIconOnly = false, fullWidth = false, isDisabled = false, onPress, className = '', children, ...props }) {
  const color = BUTTON_COLORS[variant] ?? 'gray';
  const classes = [
    'zuri-button rounded-xl',
    isIconOnly ? 'p-2' : '',
    fullWidth ? 'w-full' : '',
    variant === 'primary' ? 'zuri-button-primary' : '',
    variant === 'danger' ? 'zuri-button-danger' : '',
    variant === 'secondary' ? 'zuri-button-secondary' : '',
    variant === 'secondary' ? 'zuri-selected-pill' : '',
    variant === 'ghost' ? 'border-0 bg-transparent shadow-none hover:bg-gray-100 dark:hover:bg-gray-800' : '',
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
    <label className={`flex items-center gap-2 text-sm text-gray-900 dark:text-gray-300 ${className}`}>
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
  return <Badge color={BADGE_COLORS[color] ?? 'gray'} size={size} className={`zuri-chip zuri-chip-${color} rounded-full ${className}`.trim()} {...props}>{children}</Badge>;
}

export function Input({ label, id, isReadOnly = false, isDisabled = false, fullWidth = false, className = '', ...props }) {
  const inputId = fieldId(label, id, undefined);
  return (
    <div className={`zuri-field-wrap ${fullWidth ? 'w-full' : ''} ${className}`.trim()}>
      {label && <Label htmlFor={inputId} value={label} className={FIELD_LABEL_CLASSES} />}
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

export function DateField({ label, value, onChange, className = '', ...props }) {
  return (
    <Datepicker
      label={label}
      value={dateValue(value)}
      onChange={(next) => onChange?.(localDateValue(next))}
      className={`zuri-datepicker zuri-calendar-field ${className}`.trim()}
      {...props}
    />
  );
}

export const ComposerTextarea = forwardRef(function ComposerTextarea({ className = '', ...props }, ref) {
  return <FlowbiteTextarea ref={ref} className={`composer-textarea resize-none overflow-x-hidden border-0 bg-transparent text-foreground shadow-none placeholder:text-muted ${className}`} {...props} />;
});

export function Textarea({ label, id, isDisabled = false, className = '', ...props }) {
  const textareaId = fieldId(label, id, undefined);
  return (
    <div className={`zuri-field-wrap ${className}`.trim()}>
      {label && <Label htmlFor={textareaId} value={label} className={FIELD_LABEL_CLASSES} />}
      <FlowbiteTextarea id={textareaId} disabled={isDisabled} className={`${FIELD_CLASSES} zuri-textarea`} {...props} />
    </div>
  );
}

export function Select({ className = '', ...props }) {
  return <FlowbiteSelect className={`zuri-select rounded-xl ${className}`.trim()} {...props} />;
}

export { Label };
