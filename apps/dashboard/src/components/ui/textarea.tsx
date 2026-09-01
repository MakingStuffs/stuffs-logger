import { formControlVariants } from "./form-control-variants";
import { cn } from "./utils";

/**
 * A multi-line text input.
 *
 * The `multiline` form of the shared field styling: same border, radius,
 * padding and focus ring as {@link Input}, minus the fixed height, so a list
 * of allowed origins can grow without the field looking like a different
 * component.
 *
 * @example
 * <Textarea id="key-origins" name="allowedOrigins" rows={4} />
 */
export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        formControlVariants({ variant: "multiline" }),
        "field-sizing-content resize-y",
        className,
      )}
      {...props}
    />
  );
}
