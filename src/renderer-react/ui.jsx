import { forwardRef, useId, Children } from 'react';
import { CalendarDate, Time } from '@internationalized/date';
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
  NumberField as HeroNumberField,
  Select as HeroSelect,
  Radio as HeroRadio,
  RadioGroup as HeroRadioGroup,
  Switch as HeroSwitch,
  TextArea,
  TextField,
  TimeField as HeroTimeField,
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

/*
 * Times are stored as 'HH:MM', never as a Time, so these two keep that contract
 * and the pages go on passing strings.
 */
function timeValue(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return new Time(hour, minute);
}

// Time keeps seconds; the app stores hours and minutes only.
function timeString(time) {
  if (!time) return '';
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
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

export function TimeField({ label, value, onChange, className = '', isDisabled = false, disabled, ...props }) {
  return (
    <HeroTimeField
      value={timeValue(value)}
      onChange={(next) => onChange?.(timeString(next))}
      isDisabled={isDisabled || Boolean(disabled)}
      className={className}
      {...props}
    >
      {label && <Label>{label}</Label>}
      <HeroTimeField.Group>
        <HeroTimeField.Input>
          {(segment) => <HeroTimeField.Segment segment={segment} />}
        </HeroTimeField.Input>
      </HeroTimeField.Group>
    </HeroTimeField>
  );
}

/*
 * Numbers: minute counts and prices. HeroUI's NumberField owns the stepper
 * buttons and the parsing, and the page keeps handing it the string it holds.
 * Six decimals and no thousands groups, so 0.001 survives a re-render.
 */
export function NumberField({ label, value, onChange, min, max, step, placeholder, className = '', isDisabled = false, disabled, formatOptions, ...props }) {
  const numeric = value === '' || value === null || value === undefined ? Number.NaN : Number(value);
  return (
    <HeroNumberField
      value={Number.isFinite(numeric) ? numeric : Number.NaN}
      onChange={(next) => onChange?.({ target: { value: Number.isFinite(next) ? String(next) : '' } })}
      minValue={min === undefined ? undefined : Number(min)}
      maxValue={max === undefined ? undefined : Number(max)}
      step={step === undefined ? undefined : Number(step)}
      formatOptions={formatOptions ?? { useGrouping: false, maximumFractionDigits: 6 }}
      isDisabled={isDisabled || Boolean(disabled)}
      className={className}
      {...props}
    >
      {label && <Label>{label}</Label>}
      <HeroNumberField.Group>
        <HeroNumberField.DecrementButton />
        <HeroNumberField.Input placeholder={placeholder} />
        <HeroNumberField.IncrementButton />
      </HeroNumberField.Group>
    </HeroNumberField>
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

/**
 * An on-or-off setting: the assistant overlay, and anything else that is simply
 * on or off. HeroUI's Switch keeps the keyboard handling and the aria-checked
 * state; a page passes the same `checked`/`onChange` contract the tick box took,
 * so only the shape of the control changed.
 */
export function Switch({ className = '', checked, isSelected, onChange, disabled, isDisabled, children, ...props }) {
  return (
    <HeroSwitch
      className={className}
      isSelected={isSelected ?? checked}
      isDisabled={isDisabled ?? disabled}
      onChange={(selected) => onChange?.({ target: { checked: selected } })}
      {...props}
    >
      {children ?? (
        <>
          <HeroSwitch.Control>
            <HeroSwitch.Indicator />
          </HeroSwitch.Control>
        </>
      )}
    </HeroSwitch>
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
