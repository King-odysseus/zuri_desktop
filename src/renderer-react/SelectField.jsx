import { Label, Select } from './ui.jsx';

const EMPTY_KEY = '__empty__';

function optionKey(value) {
  return value === '' ? EMPTY_KEY : value;
}

export default function SelectField({ label, value, options, onChange, hideLabel = false, compact = false, className = '' }) {
  return (
    <div className={`flex ${compact ? 'min-w-0' : 'min-w-44'} flex-col gap-1 text-sm font-medium ${className}`}>
      {!hideLabel && <Label htmlFor={`select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} value={label} />}
      <Select
        id={`select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        aria-label={hideLabel ? label : undefined}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value === EMPTY_KEY ? '' : event.target.value)}
        sizing="md"
        className={compact ? 'w-full border-0 bg-transparent px-2 text-foreground shadow-none' : 'w-full border-border bg-surface-secondary text-foreground'}
      >
        {options.map((option) => <option key={optionKey(option.value)} value={optionKey(option.value)}>{option.label}</option>)}
      </Select>
    </div>
  );
}
