"use client";

import { Button } from "@journey-further/salient-ui/ui/button";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** How long the confirmation stays on the button, in milliseconds. */
const CONFIRMATION_MS = 2_000;

/**
 * Copies a value to the clipboard.
 *
 * The value is passed as a prop and written verbatim — it is never read back
 * out of the clipboard, and nothing about it is logged.
 */
export function CopyButton({
  value,
  label,
}: {
  value: string;
  /** What is being copied, for the button's accessible name. */
  label: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), CONFIRMATION_MS);
    } catch {
      // Clipboard access is refused outside secure contexts and when the user
      // has denied permission. Telling them to select it by hand beats a
      // button that silently does nothing.
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={copy}
      >
        {state === "copied" ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        Copy
      </Button>
      <span aria-live="polite" className="text-muted-foreground text-xs">
        {state === "copied" ? "Copied to clipboard" : null}
        {state === "failed"
          ? "Copy it manually — clipboard access was refused"
          : null}
      </span>
    </div>
  );
}
