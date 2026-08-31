import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const image = new URL("/og-100.png", base).toString();

  return {
    metadataBase: base,
    title: "The $100 Wallet Goal · 透明的百美元目标",
    description: "Can small gifts and original-work earnings across four public blockchain routes reach a combined $100? An honest, verifiable experiment.",
    alternates: {
      canonical: "/",
      types: {
        "text/plain": "/llms.txt",
        "application/json": "/ai-donation.json",
      },
    },
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "The $100 Wallet Goal",
      description: "A transparent internet generosity experiment.",
      type: "website",
      images: [{ url: image, width: 1672, height: 941, alt: "The $100 Wallet Goal" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "The $100 Wallet Goal",
      description: "A transparent internet generosity experiment.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
