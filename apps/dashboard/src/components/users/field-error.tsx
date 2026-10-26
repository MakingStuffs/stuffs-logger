/**
 * A field's validation messages, linked to the field by `id` so the field can
 * name it in `aria-describedby`.
 *
 * Renders nothing when there is nothing to say, so a field can always
 * reference the id without an empty alert being announced.
 */
export function FieldError({
  id,
  messages,
}: {
  id: string;
  messages: string[] | undefined;
}) {
  if (messages === undefined || messages.length === 0) return null;

  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {messages.join(" ")}
    </p>
  );
}
