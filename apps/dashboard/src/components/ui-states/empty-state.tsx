import type { LucideIcon } from "lucide-react";

/**
 * The "there is nothing here" state, shared by every list in the app.
 *
 * A first-run install has no applications and no events, and that must look
 * deliberate rather than broken — so an empty state always says what the area
 * is for and offers the next step, never just "no data".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  /** Sentence-case heading. */
  title: string;
  /** What this area is for, and why it is empty. */
  description: string;
  /** The next step, usually a link or button. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <Icon className="text-muted-foreground size-8" aria-hidden="true" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
