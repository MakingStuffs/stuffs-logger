/**
 * Formatting for the "usage today" figures.
 */

/** Binary units, because the byte ceiling is defined as a power of two. */
const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** Bytes per step up {@link BYTE_UNITS}. */
const BYTES_PER_UNIT = 1024;

const BYTE_FORMAT = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

/**
 * A byte count in the largest binary unit that keeps it at or above one.
 *
 * @param bytes - A non-negative byte count.
 * @returns The formatted size, e.g. `1.5 MiB`.
 * @example
 * formatBytes(1024 * 1024 * 1024); // "1 GiB"
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex += 1;
  }

  return `${BYTE_FORMAT.format(value)} ${BYTE_UNITS[unitIndex] ?? "B"}`;
}

/**
 * How much of a ceiling has been used, as a whole percentage capped at 100.
 *
 * Capped because the counters keep advancing after the ceiling is reached
 * (refused batches are still counted), and a bar past its own track says
 * nothing a full one does not.
 *
 * @param used - The amount used.
 * @param ceiling - The ceiling; a non-positive one reads as fully used.
 * @returns An integer from 0 to 100.
 */
export function percentOfCeiling(used: number, ceiling: number): number {
  if (ceiling <= 0) return 100;
  return Math.min(100, Math.floor((Math.max(0, used) / ceiling) * 100));
}
