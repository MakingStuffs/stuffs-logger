/**
 * A field's validation messages, announced as they appear.
 *
 * Renders nothing when there is nothing to say, so a field can always point
 * `aria-describedby` at it only once it exists.
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

/**
 * The ids a field's `aria-describedby` should list: its hint, and its error
 * only while one is showing.
 *
 * @param hintId - The always-present hint, if the field has one.
 * @param errorId - The error element's id.
 * @param messages - The field's current messages.
 * @returns A space-separated id list, or `undefined` when there is none.
 */
export function describedBy(
  hintId: string | undefined,
  errorId: string,
  messages: string[] | undefined,
): string | undefined {
  const ids = [hintId, messages === undefined ? undefined : errorId].filter(
    (id) => id !== undefined,
  );
  return ids.length === 0 ? undefined : ids.join(" ");
}
