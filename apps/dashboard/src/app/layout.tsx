import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";

import { APP_DISPLAY_NAME } from "@/constants/environment";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${APP_DISPLAY_NAME} - by Making Stuffs`,
    template: `%s · ${APP_DISPLAY_NAME}`,
  },
  description:
    "Self-hosted application logging for Making Stuffs: search, filter and triage logs from every app in one place.",
};

/**
 * Browser chrome, matched to the page.
 *
 * `colorScheme` tells the browser both themes are supported, which is what
 * lets it paint the correct canvas colour before the stylesheet has arrived —
 * no white flash on the way into a dark session.
 *
 * `themeColor` is the one place in the app that names a colour literally: it
 * is consumed by the OS, outside the document, so it cannot read a CSS custom
 * property. The two values track `--background` in `globals.css` and are the
 * only pair that has to be updated by hand if that token moves.
 */
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#101116" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Type, colour and the base element layer all come from `globals.css`. The
  // faces are system stacks, so there is no font to load and no `next/font`
  // wiring to do here.
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
