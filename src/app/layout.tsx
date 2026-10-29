import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { APP_NAME } from "@/lib/brand";
import "./globals.css";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Audit, fix and monitor how your site shows up in Google and AI answers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
