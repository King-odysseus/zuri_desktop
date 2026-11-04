import { forwardRef, useId, Children } from 'react';
import { CalendarDate } from '@internationalized/date';
import {
  Button as HeroButton,
  Calendar,
  Checkbox as HeroCheckbox,
  Chip as HeroChip,
  DateField as HeroDateField,
  DatePicker,
  Input as HeroInput,
  Label,
  ListBox,
  Select as HeroSelect,
  Radio as HeroRadio,
  RadioGroup as HeroRadioGroup,
  TextArea,
  TextField,
} from '@heroui/react';

/*
 * HeroUI is the only component library in the renderer.
 *
 * Every control in the window comes through this module, so a page never builds
 * a button, field, chip or select by hand. HeroUI supplies the semantics (real
 * button roles, aria wiring between label and field, a listbox popover with
 * keyboard support) and the skin, painted from the app's own palette because
 * app.css maps HeroUI's variables onto the theme tokens.
 */

// The app's variant names, kept as-is so no call site had to change: the flat
// default button is HeroUI's ghost, and the tinted secondary is its secondary,
// which is the soft accent fill with the blue ink on top.
const BUTTON_VARIANTS = {
  default: 'ghost',
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'danger',
};

export function Button({ variant = 'default', size, isIconOnly = false, fullWidth = false, isDisabled = false, disabled, onPress, className = '', children, ...props }) {
  return (
    <HeroButton
      variant={BUTTON_VARIANTS[variant] ?? 'ghost'}
      size={size}
      isIconOnly={isIconOnly}
      fullWidth={fullWidth}
      isDisabled={isDisabled || Boolean(disabled)}
      onClick={onPress}
      className={className}
      {...props}
    >
      {children}
    </HeroButton>
  );
}

export function Checkbox({ isSelected = false, checked, onChange, isDisabled = false, disabled, className = '', children, ...props }) {
  return (
    <HeroCheckbox
      isSelected={isSelected || Boolean(checked)}
      isDisabled={isDisabled || Boolean(disabled)}
      onChange={(selected) => onChange?.(selected)}
      className={className}
      {...props}
    >
      <HeroCheckbox.Content>
        <HeroCheckbox.Control>
          <HeroCheckbox.Indicator />
        </HeroCheckbox.Control>
        {children}
      </HeroCheckbox.Content>
    </HeroCheckbox>
  );
}

const CHIP_COLORS = {
  default: 'accent',
  primary: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function Chip({ color = 'default', size, className = '', children, ...props }) {
  return (
    <HeroChip color={CHIP_COLORS[color] ?? 'accent'} size={size} variant="soft" className={className} {...props}>
      {children}
    </HeroChip>
  );
}

function fieldId(label, id, fallback) {
  const generatedId = useId();
  return id ?? (label ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId.replace(/:/g, '')}` : fallback);
}

export function Input({ label, id, isReadOnly = false, isDisabled = false, fullWidth = false, className = '', disabled, readOnly, ...props }) {
  const inputId = fieldId(label, id, undefined);
  return (
    <TextField
      isDisabled={isDisabled || Boolean(disabled)}
      isReadOnly={isReadOnly || Boolean(readOnly)}
      fullWidth={fullWidth}
      className={className}
    >
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <HeroInput id={inputId} {...props} />
    </TextField>
  );
}

function dateValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new CalendarDate(year, month, day);
}

function localDateValue(value) {
  if (!value || typeof value.toString !== 'function') return '';
  // CalendarDate.toString() is already the ISO day the app stores.
  return value.toString();
}

// The visible label belongs to DatePicker itself so React Aria wires it to the
// segmented date input; the popover calendar is HeroUI's own composition.
export function DateField({ label, value, onChange, className = '', ...props }) {
  return (
    <DatePicker
      value={dateValue(value)}
      onChange={(next) => onChange?.(localDateValue(next))}
      className={className}
      {...props}
    >
      {label && <Label>{label}</Label>}
      <HeroDateField.Group>
        <HeroDateField.Input>
          {(segment) => <HeroDateField.Segment segment={segment} />}
        </HeroDateField.Input>
        <HeroDateField.Suffix>
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </HeroDateField.Suffix>
      </HeroDateField.Group>
      <DatePicker.Popover>
        <Calendar aria-label={label ?? 'Choose date'}>
          <Calendar.Header>
            <Calendar.YearPickerTrigger>
              <Calendar.YearPickerTriggerHeading />
              <Calendar.YearPickerTriggerIndicator />
            </Calendar.YearPickerTrigger>
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>
              {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
            </Calendar.GridHeader>
            <Calendar.GridBody>
              {(date) => <Calendar.Cell date={date} />}
            </Calendar.GridBody>
          </Calendar.Grid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  );
}

// The composer types into a bare, borderless field, so it keeps its own class
// for the page paint while HeroUI still owns the element and its autosize behaviour.
export const ComposerTextarea = forwardRef(function ComposerTextarea({ className = 'composer-textarea', ...props }, ref) {
  return <TextArea ref={ref} className={className} {...props} />;
});

export function Textarea({ label, id, isDisabled = false, disabled, className = '', ...props }) {
  const textareaId = fieldId(label, id, undefined);
  return (
    <TextField isDisabled={isDisabled || Boolean(disabled)} className={className}>
      {label && <Label htmlFor={textareaId}>{label}</Label>}
      <TextArea id={textareaId} {...props} />
    </TextField>
  );
}

// A native <option> list is what the app's pages hand this component, so the
// children are read as options and handed to HeroUI's ListBox instead.
function readOptions(children) {
  return Children.toArray(children)
    .filter((child) => child?.type === 'option')
    .map((child) => ({
      id: String(child.props.value ?? child.props.children),
      label: child.props.children,
      isDisabled: Boolean(child.props.disabled),
    }));
}

export function Select({ value, onChange, children, className = '', placeholder, isDisabled = false, disabled, ...props }) {
  const items = readOptions(children);
  const wanted = String(value ?? '');
  const selected = items.some((item) => item.id === wanted) ? wanted : null;
  return (
    <HeroSelect
      className={className}
      placeholder={placeholder ?? 'Choose one'}
      value={selected}
      isDisabled={isDisabled || Boolean(disabled)}
      onChange={(key) => onChange?.({ target: { value: key ?? '' } })}
      {...props}
    >
      <HeroSelect.Trigger>
        <HeroSelect.Value />
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover>
        <ListBox items={items}>
          {(item) => (
            <ListBox.Item id={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </ListBox.Item>
          )}
        </ListBox>
      </HeroSelect.Popover>
    </HeroSelect>
  );
}

export { Label };

/**
 * One choice from a short list: the age gate and the settings rows. HeroUI's
 * RadioGroup owns the arrow-key handling and the single-selection contract, so
 * the page passes a value and a change handler, never a native radio.
 */
export function RadioGroup({ value, onChange, className = '', children, ...props }) {
  return (
    <HeroRadioGroup value={value} onChange={onChange} className={className} {...props}>
      {children}
    </HeroRadioGroup>
  );
}

export function Radio({ value, className = '', children, ...props }) {
  return (
    <HeroRadio value={value} className={className} {...props}>
      <HeroRadio.Control>
        <HeroRadio.Indicator />
      </HeroRadio.Control>
      {children}
    </HeroRadio>
  );
}
