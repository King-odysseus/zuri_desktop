import { Dropdown, DropdownItem } from 'flowbite-react';
import { ChevronDownIcon } from './Icons.jsx';
import { Label } from './ui.jsx';

const EMPTY_KEY = '__empty__';

function optionKey(value) {
  return value === '' ? EMPTY_KEY : value;
}

export default function SelectField({ label, value, options, onChange, hideLabel = false, compact = false, iconOnly = false, plainTrigger = false, className = '' }) {
  const selectedOption = options.find((option) => String(option.value ?? '') === String(value ?? '')) ?? options[0];
  const fieldId = `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className={`flex ${compact ? 'min-w-0' : 'min-w-44'} flex-col gap-1 text-sm font-medium ${className}`}>
      {!hideLabel && <Label htmlFor={fieldId} value={label} />}
      <Dropdown
        inline
        arrowIcon={false}
        placement="bottom-start"
        className="zuri-dropdown-menu min-w-32"
        renderTrigger={() => (
          <button
            id={fieldId}
            type="button"
            aria-label={hideLabel ? label : undefined}
            title={`${label}: ${selectedOption?.label ?? ''}`}
            className={`zuri-dropdown-trigger ${iconOnly ? 'zuri-dropdown-icon-only' : ''} ${plainTrigger ? 'zuri-dropdown-plain-trigger' : ''} flex min-h-10 w-full items-center justify-between gap-1 rounded-xl border-0 bg-transparent px-2 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-accent/30`}
          >
            {!iconOnly && <span className="truncate">{selectedOption?.label ?? ''}</span>}
            <ChevronDownIcon size={14} />
          </button>
        )}
      >
        {options.map((option) => (
          <DropdownItem
            className="zuri-dropdown-item"
            key={optionKey(option.value)}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownItem>
        ))}
      </Dropdown>
    </div>
  );
}
