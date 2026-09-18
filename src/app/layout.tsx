import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Great_Vibes, Inter, Playfair_Display } from "next/font/google";
import { CAFE } from "@/lib/cafe";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const script = Great_Vibes({
  variable: "--font-great-vibes",
  weight: "400",
  subsets: ["latin"],
});

const display = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: CAFE.name,
  description: `${CAFE.tagline} ${CAFE.street}, ${CAFE.city}. Open ${CAFE.hours} ${CAFE.hoursNote}.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${playfair.variable} ${script.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-black font-sans text-white">{children}</body>
    </html>
  );
}
