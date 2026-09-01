import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { APP_DISPLAY_NAME } from "@/constants/environment";

import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_DISPLAY_NAME} - by Journey Further`,
  description:
    "Self-hosted application logging for Journey Further: search, filter and triage logs from every app in one place.",
};

export const viewport = {
  themeColor: "#FFFFFF",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fonts and body styling come from the salient-ui globals, which ship the
  // brand faces as @font-face rules — no next/font wiring needed here.
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
