import { Label, ListBox, Select } from '@heroui/react';

// HeroUI keys cannot be the empty string, so the "nobody in particular" option
// travels under a name of its own and is turned back into '' on the way out.
const EMPTY_KEY = '__empty__';

function optionKey(value) {
  return value === '' ? EMPTY_KEY : String(value);
}

export default function SelectField({ label, value, options, onChange, hideLabel = false, compact = false, iconOnly = false, plainTrigger = false, className = '' }) {
  const selectedOption = options.find((option) => String(option.value ?? '') === String(value ?? '')) ?? options[0];
  const items = options.map((option) => ({ id: optionKey(option.value ?? ''), label: option.label }));

  return (
    <div className={`flex ${compact ? 'min-w-0' : 'min-w-44'} flex-col gap-1 text-sm font-medium ${className}`}>
      <Select
        aria-label={label}
        placeholder={label}
        value={optionKey(value ?? '')}
        onChange={(key) => {
          const next = options.find((option) => optionKey(option.value ?? '') === key);
          onChange?.(next ? next.value : '');
        }}
      >
        {!hideLabel && <Label>{label}</Label>}
        <Select.Trigger
          title={`${label}: ${selectedOption?.label ?? ''}`}
          className={`zuri-dropdown-trigger ${iconOnly ? 'zuri-dropdown-icon-only' : ''} ${plainTrigger ? 'zuri-dropdown-plain-trigger' : ''}`.trim()}
        >
          {!iconOnly && <Select.Value />}
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="zuri-dropdown-menu min-w-32">
          <ListBox items={items}>
            {(item) => <ListBox.Item id={item.id} className="zuri-dropdown-item">{item.label}</ListBox.Item>}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
