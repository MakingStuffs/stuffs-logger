/** The prefix React gives its own progressive-enhancement form fields. */
const FRAMEWORK_FIELD_PREFIX = "$ACTION_";

/**
 * A submitted form as a plain record, ready for a STRICT schema.
 *
 * The token schemas reject unknown keys, so a caller cannot smuggle extra
 * fields past them. React may add its own `$ACTION_…` fields to a form
 * submitted before hydration; those are the framework's routing data, not
 * input, and are dropped here so the strict check only ever judges what a
 * person or script actually supplied.
 *
 * @param formData - The submitted form. Untrusted.
 * @returns Every non-framework field, last value wins.
 */
export function formFields(formData: FormData): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith(FRAMEWORK_FIELD_PREFIX)) continue;
    fields[key] = value;
  }

  return fields;
}
