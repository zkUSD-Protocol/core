import { Metadata } from "next";
import { Providers } from "@/lib/context";
import "./globals.css";

export const metadata: Metadata = {
  title: "zkUSD",
  description: "Stablecoin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head></head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
