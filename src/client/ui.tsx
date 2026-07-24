import {
  TextField,
  Badge as ThemeBadge,
  Button as ThemeButton,
  IconButton as ThemeIconButton,
  Select as ThemeSelect,
  TextArea as ThemeTextArea,
  Tooltip,
} from "@radix-ui/themes";
import type { ComponentProps, ReactNode } from "react";
import { forwardRef } from "react";

export const Button = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof ThemeButton>
>(function Button({ className = "", color, variant, ...props }, ref) {
  const classes = String(className);
  const isPrimary = classes.split(/\s+/).includes("primary");
  const isDanger = classes.split(/\s+/).includes("danger");
  return (
    <ThemeButton
      ref={ref}
      className={className}
      color={color ?? (isDanger ? "red" : undefined)}
      variant={variant ?? (isPrimary ? "solid" : "surface")}
      {...props}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof ThemeIconButton> & { label: string }
>(function IconButton({ label, children, className, ...props }, ref) {
  return (
    <Tooltip content={label}>
      <ThemeIconButton
        ref={ref}
        aria-label={label}
        className={className}
        variant="ghost"
        {...props}
      >
        {children}
      </ThemeIconButton>
    </Tooltip>
  );
});

export const TextInput = TextField.Root;
export const TextInputSlot = TextField.Slot;
export const TextArea = ThemeTextArea;
export const Badge = ThemeBadge;

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

const EMPTY_VALUE = "__pi_web_empty_value__";

export function SelectField({
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <ThemeSelect.Root
      value={value || EMPTY_VALUE}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
      disabled={disabled}
    >
      <ThemeSelect.Trigger
        aria-label={ariaLabel}
        className={className}
        placeholder={placeholder}
      />
      <ThemeSelect.Content position="popper">
        {options.map((option) => (
          <ThemeSelect.Item
            key={option.value || EMPTY_VALUE}
            value={option.value || EMPTY_VALUE}
            disabled={option.disabled}
          >
            {option.label}
          </ThemeSelect.Item>
        ))}
      </ThemeSelect.Content>
    </ThemeSelect.Root>
  );
}
