import { forwardRef, useId } from 'react';
import { Badge, Button as FlowbiteButton, Checkbox as FlowbiteCheckbox, Label, Select as FlowbiteSelect, TextInput, Textarea as FlowbiteTextarea } from 'flowbite-react';

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

const FIELD_CLASSES = 'rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400';
const FIELD_LABEL_CLASSES = 'mb-1 block text-sm font-medium text-gray-900 dark:text-white';

function fieldId(label, id, fallback) {
  const generatedId = useId();
  return id ?? (label ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId.replace(/:/g, '')}` : fallback);
}

export function Button({ variant = 'default', size, isIconOnly = false, fullWidth = false, isDisabled = false, onPress, className = '', children, ...props }) {
  const color = BUTTON_COLORS[variant] ?? 'gray';
  const classes = [
    isIconOnly ? 'p-2' : '',
    fullWidth ? 'w-full' : '',
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
  return <Badge color={BADGE_COLORS[color] ?? 'gray'} size={size} className={className} {...props}>{children}</Badge>;
}

export function Input({ label, id, isReadOnly = false, isDisabled = false, fullWidth = false, className = '', ...props }) {
  const inputId = fieldId(label, id, undefined);
  return (
    <div className={`${fullWidth ? 'w-full' : ''} ${className}`.trim()}>
      {label && <Label htmlFor={inputId} value={label} className={FIELD_LABEL_CLASSES} />}
      <TextInput id={inputId} readOnly={isReadOnly} disabled={isDisabled} sizing="md" className={`w-full ${FIELD_CLASSES}`} {...props} />
    </div>
  );
}

export const ComposerTextarea = forwardRef(function ComposerTextarea({ className = '', ...props }, ref) {
  return <FlowbiteTextarea ref={ref} className={`composer-textarea resize-none overflow-x-hidden border-0 bg-transparent text-foreground shadow-none placeholder:text-muted ${className}`} {...props} />;
});

export function Textarea({ label, id, isDisabled = false, className = '', ...props }) {
  const textareaId = fieldId(label, id, undefined);
  return (
    <div className={className}>
      {label && <Label htmlFor={textareaId} value={label} className={FIELD_LABEL_CLASSES} />}
      <FlowbiteTextarea id={textareaId} disabled={isDisabled} className={`w-full ${FIELD_CLASSES}`} {...props} />
    </div>
  );
}

export { FlowbiteSelect as Select, Label };
