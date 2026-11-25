import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-finops-router: know what every agent costs",
  description:
    "Prices every Claude Code call to the cent, collapses duplicated log lines, and answers mechanical tasks with local scripts before they reach a model.",
  openGraph: {
    title: "ai-finops-router",
    description: "Know what every agent costs. Stop paying for what a script can answer.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c10",
  colorScheme: "dark",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
