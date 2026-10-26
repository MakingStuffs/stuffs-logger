import type { Metadata, Viewport } from "next";

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
        <VercelAnalytics />
      </body>
    </html>
  );
}

/**
 * Vercel's analytics, on Vercel only.
 *
 * `<Analytics />` injects a script tag for `/_vercel/insights/script.js`,
 * which only Vercel's own edge serves. Self-hosted, that is a 404 on every
 * page view and a console error in every session — on a product whose whole
 * point is a clean console. `VERCEL=1` is set by the platform at build and run
 * time, so the decision is made on the server, and the import is dynamic so a
 * self-hosted build ships no analytics code to the browser either: the
 * component's client chunk is only referenced when it is actually rendered.
 */
async function VercelAnalytics() {
  if (process.env.VERCEL !== "1") return null;

  const { Analytics } = await import("@vercel/analytics/next");

  return <Analytics />;
}
