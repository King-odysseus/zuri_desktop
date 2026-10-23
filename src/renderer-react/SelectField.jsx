import { ListBox, Select } from '@heroui/react';

const EMPTY_KEY = '__empty__';

function optionKey(value) {
  return value === '' ? EMPTY_KEY : value;
}

export default function SelectField({ label, value, options, onChange, hideLabel = false, className = '' }) {
  const selectedKey = optionKey(String(value ?? ''));

  return (
    <div className={`flex min-w-44 flex-col gap-1 text-sm font-medium ${className}`}>
      {!hideLabel && <span>{label}</span>}
      <Select
        aria-label={label}
        selectedKey={selectedKey}
        onSelectionChange={(key) => onChange(String(key) === EMPTY_KEY ? '' : String(key))}
        fullWidth
      >
        <Select.Trigger className="h-10 justify-between rounded-medium border border-border bg-surface-secondary px-3 font-normal text-foreground">
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
