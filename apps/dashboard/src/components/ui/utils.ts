import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Builds a class string, resolving Tailwind conflicts in favour of the last
 * value.
 *
 * Every component in `components/ui` takes an optional `className` and merges
 * it through here, which is what lets a call site override a single utility
 * (`<Badge className="w-16">`) without the base classes fighting it.
 *
 * @param inputs - Class values: strings, arrays, or conditional objects.
 * @returns The merged class string.
 * @example
 * cn("px-2 py-1", isWide && "px-6"); // "py-1 px-6"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
