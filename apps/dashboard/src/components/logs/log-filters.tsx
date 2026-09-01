import { Button } from "@journey-further/salient-ui/ui/button";
import { formControlVariants } from "@journey-further/salient-ui/ui/form-control-variants";
import { Input } from "@journey-further/salient-ui/ui/input";
import { cn } from "@journey-further/salient-ui/lib";
import { ChevronDown, RotateCcw, Search } from "lucide-react";
import Link from "next/link";

import type { ApplicationSummary } from "@/lib/logs/dto";
import type { LogFilters } from "@/lib/logs/filters";
import { MAX_SEARCH_LENGTH } from "@/lib/logs/filters";

import {
  DEVICE_LABELS,
  DEVICE_OPTIONS,
  LEVEL_LABELS,
  LEVEL_OPTIONS,
  PAGE_SIZE_OPTIONS,
  SOURCE_LABELS,
  SOURCE_OPTIONS,
} from "./filter-vocabulary";
import { toDateTimeLocalValue } from "./format";
import { LOGS_PATH, timeRangeHref } from "./search-params";
import { QUICK_RANGES, quickRangeStart } from "./time-ranges";

/**
 * The log explorer's filter panel.
 *
 * A plain `GET` form, and therefore a SERVER component with no JavaScript at
 * all: submitting it puts every filter in the query string, which is exactly
 * where the state has to live for a view to be server-rendered, shareable and
 * back-button-correct. Native controls also come with real labels, real
 * keyboard behaviour and real focus management for free.
 *
 * Two deliberate omissions from the form's fields: `cursor`, so changing a
 * filter always lands on the newest page rather than a stale offset, and any
 * field the validator does not name — its schema is closed, so an extra
 * control would turn every submission into an error.
 */
export function LogFiltersPanel({
  filters,
  applications,
  environments,
  now,
}: {
  /** The filters currently applied, echoed back into the controls. */
  filters: LogFilters;
  /** Applications the viewer can scope to. */
  applications: ApplicationSummary[];
  /** Environments seen in the data, for the environment facet. */
  environments: string[];
  /** Reference instant for the quick-range links, from the server's clock. */
  now: Date;
}) {
  // A URL may legitimately carry a page size the menu does not offer; adding it
  // keeps the select honest instead of silently snapping to a different value
  // the next time the form is submitted.
  const pageSizes = [...new Set([...PAGE_SIZE_OPTIONS, filters.limit])].sort(
    (left, right) => left - right,
  );

  const hasSecondaryFilter =
    filters.source !== undefined ||
    filters.deviceType !== undefined ||
    filters.environment !== undefined;

  return (
    <section
      aria-labelledby="log-filters-heading"
      className="bg-card rounded-lg border p-4"
    >
      <h2 id="log-filters-heading" className="sr-only">
        Filter logs
      </h2>

      <nav aria-label="Quick time ranges" className="mb-4 flex flex-wrap gap-2">
        <QuickRangeLink href={timeRangeHref(filters, undefined)}>
          All time
        </QuickRangeLink>
        {QUICK_RANGES.map((range) => (
          <QuickRangeLink
            key={range.label}
            href={timeRangeHref(filters, quickRangeStart(now, range.minutes))}
          >
            {range.label}
          </QuickRangeLink>
        ))}
      </nav>

      <form
        action={LOGS_PATH}
        method="get"
        aria-label="Log filters"
        className="flex flex-col gap-4"
      >
        {/* Carried through so a link that scoped by id keeps working when the
            form is submitted; the visible control scopes by slug. */}
        {filters.applicationId === undefined ? null : (
          <input
            type="hidden"
            name="applicationId"
            value={filters.applicationId}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Application" htmlFor="filter-application">
            <select
              id="filter-application"
              name="applicationSlug"
              defaultValue={filters.applicationSlug ?? ""}
              className={cn(formControlVariants(), "cursor-pointer")}
            >
              <option value="">All applications</option>
              {applications.map((application) => (
                <option key={application.id} value={application.slug}>
                  {application.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Message contains"
            htmlFor="filter-search"
            className="sm:col-span-2"
          >
            <Input
              id="filter-search"
              name="search"
              type="search"
              maxLength={MAX_SEARCH_LENGTH}
              defaultValue={filters.search ?? ""}
              placeholder="e.g. timeout"
            />
          </Field>

          <Field label="Results per page" htmlFor="filter-limit">
            <select
              id="filter-limit"
              name="limit"
              defaultValue={String(filters.limit)}
              className={cn(formControlVariants(), "cursor-pointer")}
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size} rows
                </option>
              ))}
            </select>
          </Field>

          <Field label="From (UTC)" htmlFor="filter-from">
            <Input
              id="filter-from"
              name="from"
              type="datetime-local"
              defaultValue={toDateTimeLocalValue(filters.from)}
            />
          </Field>

          <Field label="To (UTC)" htmlFor="filter-to">
            <Input
              id="filter-to"
              name="to"
              type="datetime-local"
              defaultValue={toDateTimeLocalValue(filters.to)}
            />
          </Field>
        </div>

        <ChipFieldset legend="Level">
          {LEVEL_OPTIONS.map((level) => (
            <Chip
              key={level}
              name="level"
              value={level}
              label={LEVEL_LABELS[level]}
              checked={filters.level?.includes(level) ?? false}
            />
          ))}
        </ChipFieldset>

        <details open={hasSecondaryFilter} className="group">
          <summary className="focus-visible:ring-ring inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
            More filters
            <span aria-hidden="true" className="text-muted-foreground">
              {" "}
              (source, device, environment)
            </span>
          </summary>

          <div className="flex flex-col gap-4 pt-4">
            <ChipFieldset legend="Source">
              {SOURCE_OPTIONS.map((source) => (
                <Chip
                  key={source}
                  name="source"
                  value={source}
                  label={SOURCE_LABELS[source]}
                  checked={filters.source?.includes(source) ?? false}
                />
              ))}
            </ChipFieldset>

            <ChipFieldset legend="Device">
              {DEVICE_OPTIONS.map((device) => (
                <Chip
                  key={device}
                  name="deviceType"
                  value={device}
                  label={DEVICE_LABELS[device]}
                  checked={filters.deviceType?.includes(device) ?? false}
                />
              ))}
            </ChipFieldset>

            {environments.length === 0 ? null : (
              <ChipFieldset legend="Environment">
                {environments.map((environment) => (
                  <Chip
                    key={environment}
                    name="environment"
                    value={environment}
                    label={environment}
                    checked={
                      filters.environment?.includes(environment) ?? false
                    }
                  />
                ))}
              </ChipFieldset>
            )}
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">
            <Search className="size-4" aria-hidden="true" />
            Apply filters
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={LOGS_PATH}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Clear filters
            </Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

function QuickRangeLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <Link
      href={href}
      className="border-input hover:bg-muted focus-visible:ring-ring rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* A native label rather than the design system's: `Label` is a client
          component, and pulling a JavaScript bundle into an otherwise static
          form to render a `<label>` is a poor trade. */}
      <label htmlFor={htmlFor} className="text-sm leading-none font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChipFieldset({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm leading-none font-medium">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/**
 * A checkbox rendered as a chip.
 *
 * The input stays a real checkbox — visually hidden, not removed — so it is
 * focusable, announced, toggled by the spacebar and submitted by the form. The
 * chip is its visible label.
 */
function Chip({
  name,
  value,
  label,
  checked,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <span className="border-input peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2">
        {label}
      </span>
    </label>
  );
}
