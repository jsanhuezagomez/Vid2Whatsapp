import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Vid2WhatsApp",
  description: "Convierte un momento de YouTube en un sticker listo para WhatsApp."
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
