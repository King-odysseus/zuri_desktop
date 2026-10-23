import { ListBox, Select } from '@heroui/react';

const EMPTY_KEY = '__empty__';

function optionKey(value) {
  return value === '' ? EMPTY_KEY : value;
}

export default function SelectField({ label, value, options, onChange, hideLabel = false, compact = false, className = '' }) {
  const selectedKey = optionKey(String(value ?? ''));

  return (
    <div className={`flex ${compact ? 'min-w-0' : 'min-w-44'} flex-col gap-1 text-sm font-medium ${className}`}>
      {!hideLabel && <span>{label}</span>}
      <Select
        aria-label={label}
        selectedKey={selectedKey}
        onSelectionChange={(key) => onChange(String(key) === EMPTY_KEY ? '' : String(key))}
        fullWidth
      >
        <Select.Trigger className={compact
          ? 'h-10 justify-between rounded-full border-0 bg-transparent px-2 font-normal text-foreground shadow-none'
          : 'h-10 justify-between rounded-medium border border-border bg-surface-secondary px-3 font-normal text-foreground'}>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="z-50">
          <ListBox>
            {options.map((option) => (
              <ListBox.Item key={optionKey(option.value)} textValue={option.label}>
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
