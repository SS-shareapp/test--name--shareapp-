import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shareapp",
  description: "Encrypted file sharing with R2-backed transfer codes"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "pk_test_Y2xlcmsubG9jYWxob3N0JA==";

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
