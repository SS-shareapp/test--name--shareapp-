import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "react-hot-toast";
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
    <ClerkProvider 
      publishableKey={publishableKey}
      appearance={{ layout: { unsafe_disableDevelopmentModeWarnings: true } }}
    >
      <html lang="en">
        <body>
          {children}
          <Toaster 
            position="bottom-center" 
            toastOptions={{
              style: {
                background: '#141414',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                fontSize: '14px',
              },
            }}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
