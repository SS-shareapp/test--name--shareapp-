import type { Metadata } from "next";
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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('shareapp-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark-theme')}else{document.documentElement.classList.add('light-theme')}}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
