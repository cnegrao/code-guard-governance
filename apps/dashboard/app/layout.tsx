import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GOVERNYX — AI Governance Intelligence",
  description:
    "GOVERNYX — AI Governance Intelligence for organisations that develop, deploy, operate or supervise AI systems.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background-dark text-white antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
