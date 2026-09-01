import { cn } from "../ui/utils";

/**
 * A block of untrusted text — a context blob, a stack trace, a user agent.
 *
 * The one component every such value goes through, so the safety property is
 * stated once instead of being re-argued at each call site: the value arrives
 * as a plain string prop and is rendered as a React CHILD, which React escapes.
 * There is no `dangerouslySetInnerHTML` here, and there must never be: a log
 * message is written by whoever holds an ingest key, and a public ingest key
 * is designed to be readable in browser JavaScript.
 */
export function TextBlock({
  children,
  label,
  className,
}: {
  /** The untrusted text. */
  children: string;
  /** Accessible name for the scrollable region. */
  label: string;
  className?: string;
}) {
  return (
    <pre
      // Scrollable regions must be reachable by keyboard, or a trace longer
      // than the viewport is unreadable without a mouse.
      tabIndex={0}
      role="group"
      aria-label={label}
      className={cn(
        // Full-contrast text on a recessed surface: the block is set apart by
        // its background, never by dimming the thing you came here to read.
        "bg-muted text-foreground max-h-96 overflow-auto rounded-md border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap",
        "focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </pre>
  );
}
