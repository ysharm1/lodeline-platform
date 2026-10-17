import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./_components/app-shell";
import { siteUrl } from "../_site/seo";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Lodeline · Supply-chain evidence for magnets, tungsten and tantalum", template: "%s · Lodeline" },
  icons: { icon: "/assets/mark.svg" },
  openGraph: { siteName: "Lodeline", type: "website", images: [{ url: "/assets/img/hero-magnetic-field.jpg" }] },
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
