import type { Metadata, Viewport } from "next";
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

export const metadata: Metadata = {
  title: { default: "Till Financial Freedom", template: "%s · Till" },
  description: "Personal wealth tracker.",
  appleWebApp: { capable: true, title: "Till", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e12" },
  ],
};

// Same key as PRIVACY_KEY in components/PrivacyProvider.tsx; runs before first paint so amounts never flash.
const privacyBoot = `try{if(localStorage.getItem("till:privacy")==="on")document.documentElement.setAttribute("data-privacy-boot","")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: privacyBoot }} />
        {children}
      </body>
    </html>
  );
}
