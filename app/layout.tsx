import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./_components/app-shell";

export const metadata: Metadata = {
  title: "Lodeline · Supply-chain evidence for magnets, tungsten and tantalum",
  description: "Supply-chain documentation and analysis for DFARS 252.225-7052 evidence. Not legal advice or government certification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
