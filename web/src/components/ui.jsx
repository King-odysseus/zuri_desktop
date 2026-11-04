import { Children } from 'react';
import {
  Alert,
  Button as HeroButton,
  Card as HeroCard,
  Checkbox as HeroCheckbox,
  Chip as HeroChip,
  Input as HeroInput,
  Label,
  ListBox,
  ProgressBar,
  Radio as HeroRadio,
  RadioGroup as HeroRadioGroup,
  Select as HeroSelect,
  TextArea,
} from '@heroui/react';

/**
 * HeroUI is the only component library on the site.
 *
 * HeroUI supplies both halves: the semantics (a real button, a real progressbar
 * with aria-valuenow, a listbox with keyboard support) and the skin, painted
 * from the product tokens mapped onto HeroUI's own CSS variables in styles.css.
 * The names below are the ones the pages already speak, so a call site never has
 * to learn HeroUI's API and no page builds a control of its own.
 */

const BUTTON_VARIANTS = {
  primary: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
};

export function Button({ variant = 'primary', block = false, className = '', type = 'button', disabled, isDisabled, ...props }) {
  return (
    <HeroButton
      type={type}
      variant={BUTTON_VARIANTS[variant] ?? 'primary'}
      fullWidth={block}
      isDisabled={isDisabled ?? disabled}
      className={className}
      {...props}
    />
  );
}

/**
 * A square control that holds one icon: copy, close, delete, send.
 *
 * HeroUI's Button keeps the semantics and the pressed, focus and disabled
 * states. An icon alone has no readable name, so the label is required rather
 * than optional, and it becomes both the accessible name and the hover title.
 *
 * @param {{
 *   label: string,
 *   tone?: 'quiet' | 'danger' | 'primary',
 *   size?: 'sm' | 'md',
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export function IconButton({ label, tone = 'quiet', size = 'md', className = '', disabled, isDisabled, children, ...props }) {
  return (
    <HeroButton
      isIconOnly
      type="button"
      variant={tone === 'danger' ? 'danger' : tone === 'primary' ? 'primary' : 'ghost'}
      size={size === 'sm' ? 'sm' : 'md'}
      isDisabled={isDisabled ?? disabled}
      aria-label={label}
      title={label}
      className={className}
      {...props}
    >
      {children}
    </HeroButton>
  );
}

// The site speaks in tones; HeroUI speaks in colours. "primary" has no colour of
// its own because a filled navy pill would out-shout the label it annotates, so
// it leans on the accent soft fill, the same one the selected rows use.
const CHIP_COLORS = {
  default: 'default',
  accent: 'accent',
  primary: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** A pill label: the plan tile's "Current plan", the hero's eyebrow and the preview chip. */
export function Chip({ tone = 'default', color, className = '', children }) {
  return (
    <HeroChip color={CHIP_COLORS[color ?? tone] ?? 'default'} variant="soft" className={className}>
      {children}
    </HeroChip>
  );
}

/**
 * Token allowance bar. HeroUI's ProgressBar gives the element role="progressbar"
 * and aria-valuenow, and draws its fill and track from the same tokens as the rest
 * of the page, so the warning state is the only thing a caller decides.
 */
export function UsageBar({ percent, warn = false, label = 'usage' }) {
  const value = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return (
    <ProgressBar value={value} color={warn ? 'warning' : 'accent'} aria-label={`${label} ${value}%`} className="bar">
      <ProgressBar.Track>
        <ProgressBar.Fill className={warn ? 'bar-fill is-warning' : 'bar-fill'} />
      </ProgressBar.Track>
      <ProgressBar.Output className="sr-only" />
    </ProgressBar>
  );
}

/** A status line: a payment confirmation, or an error worth reading twice. */
export function Notice({ kind = 'info', children }) {
  if (!children) return null;
  const status = kind === 'error' ? 'danger' : kind === 'success' ? 'success' : 'default';
  return (
    <Alert status={status} role="status" className="notice">
      {children}
    </Alert>
  );
}

/** Inline dashboard warning, the same alert component with the page's own tone. */
export function InlineAlert({ tone = 'warning', children }) {
  if (!children) return null;
  const status = tone === 'danger' ? 'danger' : tone === 'info' ? 'default' : 'warning';
  return (
    <Alert status={status} role="status" className={`alert${tone === 'danger' ? ' is-danger' : ''}${tone === 'info' ? ' is-info' : ''}`}>
      {children}
    </Alert>
  );
}

/**
 * Text field. HeroUI's Input keeps the ref, the value and the change event, so a
 * page keeps using the same props it used on the plain element; disabled and
 * readOnly are translated because HeroUI names them isDisabled and isReadOnly.
 */
export function Input({ className = '', disabled, isDisabled, readOnly, isReadOnly, ...props }) {
  return (
    <HeroInput
      className={className}
      isDisabled={isDisabled ?? disabled}
      isReadOnly={isReadOnly ?? readOnly}
      {...props}
    />
  );
}

export function Textarea({ className = '', disabled, isDisabled, readOnly, isReadOnly, ...props }) {
  return (
    <TextArea
      className={className}
      isDisabled={isDisabled ?? disabled}
      isReadOnly={isReadOnly ?? readOnly}
      {...props}
    />
  );
}

/**
 * Checkbox. A page passes a native-looking contract (checked/disabled) and gets
 * HeroUI's control, indicator and label wiring back.
 */
export function Checkbox({ className = '', checked, isSelected, onChange, disabled, isDisabled, children, ...props }) {
  return (
    <HeroCheckbox
      className={className}
      isSelected={isSelected ?? checked}
      isDisabled={isDisabled ?? disabled}
      onChange={(selected) => onChange?.({ target: { checked: selected } })}
      {...props}
    >
      {children ?? (
        <HeroCheckbox.Control>
          <HeroCheckbox.Indicator />
        </HeroCheckbox.Control>
      )}
    </HeroCheckbox>
  );
}

// A native <option> list is what the pages hand a select, so the children are
// read as options and handed to HeroUI's listbox, and the change event is shaped
// like the native one so no handler had to change.
function readOptions(children) {
  return Children.toArray(children)
    .filter((child) => child?.type === 'option')
    .map((child) => ({
      id: String(child.props.value ?? child.props.children),
      label: child.props.children,
      isDisabled: Boolean(child.props.disabled),
    }));
}

export function Select({ value, onChange, children, className = '', placeholder, disabled, isDisabled, ...props }) {
  const items = readOptions(children);
  const wanted = String(value ?? '');
  const selected = items.some((item) => item.id === wanted) ? wanted : null;
  return (
    <HeroSelect
      className={className}
      placeholder={placeholder ?? 'Choose one'}
      value={selected}
      isDisabled={isDisabled ?? disabled}
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

export { Label, HeroCard as Card };

/**
 * One choice from a short list: the settings rows. HeroUI's RadioGroup owns the
 * arrow-key handling and the single-selection contract, so a page passes a value
 * and a change handler instead of drawing a native radio by hand.
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
