import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import BackgroundCanvas from "./components/BackgroundCanvas";
import Cursor from "./components/Cursor";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    "pk_test_Y2xlcmsubG9jYWxob3N0JA";

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <html lang="en" className={poppins.variable}>
        <body>
          <VideoBg />
          <BackgroundCanvas />
          <Cursor />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
