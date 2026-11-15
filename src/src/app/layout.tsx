import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import ClerkProviderWithTheme from "./components/ClerkProviderWithTheme";
import ThemeAssets from "./components/ThemeAssets";
import "./globals.css";

const bodyFont = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-body" });
const displayFont = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-display" });

export const metadata: Metadata = {
  title: "Flock — Share Files, Freely",
  description:
    "Share a file up to 1 GiB with a private code. Encrypted in your browser, easy to receive.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Start Next.js with your 1Password-provided environment loaded.",
    );
  }

  return (
    <ClerkProviderWithTheme publishableKey={publishableKey}>
      <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
        <body>
          <a href="#main" className="skip-link">Skip to content</a>
          <ThemeAssets />
          <main id="main">{children}</main>
        </body>
      </html>
    </ClerkProviderWithTheme>
  );
}
