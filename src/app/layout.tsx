import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AskLex — Legal & Research Document Assistant",
  description:
    "Ask questions about legal documents and research papers. Powered by NVIDIA NIM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
