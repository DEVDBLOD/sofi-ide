import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sofi IDE",
  description: "A functional web-based IDE",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
