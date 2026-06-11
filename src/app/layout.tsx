import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Vid2WhatsApp",
  description: "Turn a YouTube timestamp into a WhatsApp-ready WebP sticker."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
