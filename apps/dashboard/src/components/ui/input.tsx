import { formControlVariants } from "./form-control-variants";
import { cn } from "./utils";

/**
 * A single-line text input.
 *
 * Carries no behaviour of its own — it is the shared field styling on a native
 * `<input>`, so it keeps every native affordance (autofill, validation, the
 * browser's own date and search widgets) and works on a page that ships no
 * JavaScript.
 *
 * @example
 * <Input id="filter-search" name="search" type="search" />
 */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        formControlVariants(),
        // Native pickers ship their own indicator glyph; letting it take the
        // text colour stops it disappearing in dark mode.
        "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
