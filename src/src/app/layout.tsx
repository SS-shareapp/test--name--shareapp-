import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import ClerkProviderWithTheme from "./components/ClerkProviderWithTheme";
import BackgroundCanvas from "./components/BackgroundCanvas";
import Cursor from "./components/Cursor";
import ThemeAssets from "./components/ThemeAssets";
import VideoBg from "./components/VideoBg";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Flock — Share Files, Freely",
  description:
    "Drop your files. Get a link instantly. No sign-up, no limits, no nonsense.",
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
      <html lang="en" className={poppins.variable}>
        <body>
          <ThemeAssets />
          <VideoBg />
          <BackgroundCanvas />
          <Cursor />
          {children}
        </body>
      </html>
    </ClerkProviderWithTheme>
  );
}
