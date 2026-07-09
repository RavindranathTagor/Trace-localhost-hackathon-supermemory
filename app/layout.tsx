import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trace — contradiction-free memory for your coding agent",
  description:
    "A local-first memory-integrity layer built on Supermemory Local. Catches drift, resolves to a single current truth, keeps your agent's context clean.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
