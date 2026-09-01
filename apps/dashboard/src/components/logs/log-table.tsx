"use client";

import { useCallback, useState } from "react";

import type { LogEventListItem } from "@/lib/logs/dto";

import {
  Table,
  TableBody,
  TableCaption,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

import { LogRow } from "./log-row";

/**
 * The log stream as a table.
 *
 * The one client component in the explorer, and it exists for exactly one
 * reason: rows expand. Everything else on the page — the filters, the
 * pagination, the counts — is server-rendered, because it is all encoded in
 * the URL and needs no JavaScript to work.
 *
 * A SINGLE piece of state, the id of the open row, held here rather than one
 * `useState` per row. That keeps the page to one hydration boundary instead of
 * two hundred, and lets the memoised rows re-render only in pairs.
 */
export function LogTable({ events }: { events: LogEventListItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Stable across renders, so a row's props only change when its own expanded
  // state does — without this the memo on LogRow would never hit.
  const toggle = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  return (
    <div className="bg-card rounded-lg border">
      <Table>
        <TableCaption className="sr-only">
          Log events, newest first. All times are UTC. Each row can be expanded
          for the event&rsquo;s full detail.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-10">
              <span className="sr-only">Expand row</span>
            </TableHead>
            <TableHead scope="col">Time (UTC)</TableHead>
            <TableHead scope="col">Level</TableHead>
            <TableHead scope="col">Application</TableHead>
            <TableHead scope="col">Environment</TableHead>
            <TableHead scope="col">Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <LogRow
              key={event.id}
              event={event}
              isExpanded={expandedId === event.id}
              onToggle={toggle}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
