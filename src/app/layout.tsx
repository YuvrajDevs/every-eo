import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { headers } from "next/headers";
import { APP_NAME } from "@/lib/brand";
import "./globals.css";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Audit, fix and monitor how your site shows up in Google and AI answers.",
};

// Reading the request makes every page render per request, which the CSP nonce set in proxy.ts requires
// (Next.js adds the nonce to its scripts automatically).
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers();
  return (
    <html lang="en">
      <body className={`${outfit.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
