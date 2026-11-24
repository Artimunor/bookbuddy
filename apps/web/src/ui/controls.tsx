import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Link, type To } from "react-router";
import { Glyph } from "./glyph";

const buttonVariants = {
  primary: "bb-button--primary",
  live: "bb-button--live",
  secondary: "bb-button--secondary",
  text: "bb-button--text",
  destructive: "bb-button--destructive",
};

type ButtonAppearance = {
  children: ReactNode;
  variant?: keyof typeof buttonVariants;
  className?: string;
};

export type ButtonProps = ButtonAppearance & Omit<ComponentPropsWithoutRef<"button">, keyof ButtonAppearance> & {
  pending?: boolean;
};

export function Button({ children, variant = "primary", className = "", pending = false, type = "button", onClick, ...button }: ButtonProps) {
  const unavailable = pending || button["aria-disabled"] === true || button["aria-disabled"] === "true";
  return (
    <button {...button} type={type} className={`bb-button ${buttonVariants[variant]} ${className}`}
      aria-busy={pending || undefined} aria-disabled={unavailable || undefined}
      onClick={(event) => {
        if (unavailable) event.preventDefault();
        else onClick?.(event);
      }}>
      {pending && <span className="bb-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

type ActionLinkProps = ButtonAppearance & { to: To };

export function ActionLink({ children, variant = "primary", className = "", to }: ActionLinkProps) {
  return <Link to={to} className={`bb-button ${buttonVariants[variant]} ${className}`}>{children}</Link>;
}

type ActionBarProps = {
  context?: string;
  primary: ({ to: To } | Pick<ButtonProps, "type" | "onClick" | "form" | "disabled" | "pending">) & { label: string; live?: boolean };
  secondary?: { label: string; onClick: NonNullable<ButtonProps["onClick"]>; disabled?: boolean } | { label: string; to: To };
};

export function Dock({ context, primary: { label, live, ...primary }, secondary }: ActionBarProps) {
  const contextId = useId();
  return (
    <div className="bb-dock">
      {context && <p id={contextId} className="text-supporting text-muted">{context}</p>}
      <div className="bb-dock-actions">
        {secondary && ("to" in secondary
          ? <ActionLink variant="text" to={secondary.to}>{secondary.label}</ActionLink>
          : <Button variant="text" disabled={secondary.disabled} onClick={secondary.onClick}>{secondary.label}</Button>)}
        {"to" in primary
          ? <ActionLink to={primary.to} variant={live ? "live" : "primary"}>{label}</ActionLink>
          : <Button {...primary} aria-describedby={context ? contextId : undefined} variant={live ? "live" : "primary"}>{label}</Button>}
      </div>
    </div>
  );
}

type InputProps = Omit<ComponentPropsWithoutRef<"input">, "children" | "className" | "size" | "aria-invalid">;

export type TextFieldProps = InputProps & {
  label: string;
  hint?: string;
  error?: string;
};

function LabeledInput({ label, hint, error, id, "aria-describedby": description, ...input }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;
  return (
    <div className="bb-field">
      <label htmlFor={inputId} className="text-label">{label}</label>
      <input {...input} id={inputId} className="bb-input" aria-invalid={error ? true : undefined}
        aria-describedby={[description, hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined} />
      {hint && <p id={hintId} className="text-supporting text-muted">{hint}</p>}
      {error && <p id={errorId} className="text-supporting text-critical-ink">{error}</p>}
    </div>
  );
}

export function TextField({ type = "text", dir = "auto", ...props }: TextFieldProps) {
  return <LabeledInput {...props} type={type} dir={dir} />;
}

export type CodeFieldProps = Omit<TextFieldProps, "type" | "inputMode" | "dir" | "autoComplete" | "minLength" | "maxLength" | "pattern"> & {
  length?: number;
};

export function CodeField({ length = 6, ...props }: CodeFieldProps) {
  return <LabeledInput {...props} type="text" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
    maxLength={length} pattern={`[0-9]{${length}}`} data-code="true" />;
}

type SelectProps = Omit<ComponentPropsWithoutRef<"select">, "className" | "size"> & { label: string; hint?: string };

export function Select({ label, hint, children, id, "aria-describedby": description, ...select }: SelectProps) {
  const fieldId = useId();
  const selectId = id ?? fieldId;
  const hintId = `${fieldId}-hint`;
  return <div className="bb-field">
    <label htmlFor={selectId} className="text-label">{label}</label>
    <div className="bb-select">
      <select {...select} id={selectId} className="bb-input"
        aria-describedby={[description, hint ? hintId : undefined].filter(Boolean).join(" ") || undefined}>{children}</select>
      <Glyph name="chevron" />
    </div>
    {hint && <p id={hintId} className="text-supporting text-muted">{hint}</p>}
  </div>;
}

type ChoiceOption<T> = { value: T; label: ReactNode; disabled?: boolean };
type ChoiceGroupProps<T extends string> = {
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onValueChange: (value: T) => void;
  disabled?: boolean;
};

export function ChoiceGroup<T extends string>({ label, options, value, onValueChange, disabled }: ChoiceGroupProps<T>) {
  const groupId = useId();
  return <fieldset disabled={disabled} className="bb-field bb-choices">
    <legend className="mb-2 text-label">{label}</legend>
    {options.map(option => <label className="bb-choice" key={option.value}>
      <input className="sr-only" type="radio" name={groupId} value={option.value}
        checked={value === option.value} disabled={option.disabled} onChange={() => onValueChange(option.value)} />
      <span className="bb-choice-body">
        <span className="bb-choice-indicator" aria-hidden="true">{value === option.value && <Glyph name="check" />}</span>
        <span className="min-w-0">{option.label}</span>
      </span>
    </label>)}
  </fieldset>;
}

export type SegmentedControlProps<T extends string> = {
  label: string;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onValueChange: (value: T) => void;
  name?: string;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({ label, options, value, onValueChange, name, disabled }: SegmentedControlProps<T>) {
  const groupId = useId();
  return (
    <fieldset disabled={disabled} className="bb-field min-w-0">
      <legend className="mb-2 text-label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label className="bb-segment" key={option.value}>
            <input className="sr-only" type="radio" name={name ?? groupId} value={option.value} checked={value === option.value}
              disabled={option.disabled} onChange={() => onValueChange(option.value)} />
            <span className="bb-segment-label">
              {value === option.value && <span aria-hidden="true">✓ </span>}{option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type SwitchRowProps = {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
};

export function SwitchRow({ label, description, checked, onCheckedChange, disabled, name }: SwitchRowProps) {
  const id = useId();
  const descriptionId = `${id}-help`;
  return (
    <label className="bb-switch-row" htmlFor={id}>
      <span className="min-w-0">
        <span className="text-label" id={`${id}-label`}>{label}</span>
        {description && <span className="mt-1 block text-supporting text-muted" id={descriptionId}>{description}</span>}
      </span>
      <span className="bb-switch-target">
        <input className="sr-only" id={id} type="checkbox" role="switch" aria-labelledby={`${id}-label`}
          aria-describedby={description ? descriptionId : undefined}
          checked={checked} disabled={disabled} name={name} onChange={(event) => onCheckedChange(event.currentTarget.checked)} />
        <span className="bb-switch-track" aria-hidden="true"><span /></span>
      </span>
    </label>
  );
}
