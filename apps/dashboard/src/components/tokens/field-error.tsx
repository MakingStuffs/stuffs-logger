/** A field's validation messages, linked to its input by `id`. */
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
