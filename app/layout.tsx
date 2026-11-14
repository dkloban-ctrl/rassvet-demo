import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "./providers";
import { SwRegister } from "@/components/SwRegister";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Рассвет",
  description: "Подростковое служение церкви «Вифания»",
  manifest: `${base}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "Рассвет", statusBarStyle: "black-translucent" },
  icons: {
    icon: `${base}/icon-192.png`,
    apple: `${base}/apple-touch-icon.png`,
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1c2340",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh antialiased">
        <AuthProvider>{children}</AuthProvider>
        <SwRegister />
      </body>
    </html>
  );
}
