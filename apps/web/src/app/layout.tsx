import type { ReactNode } from "react";

export const metadata = { title: "Creative Engine" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24, maxWidth: 720 }}>{children}</body>
    </html>
  );
}
