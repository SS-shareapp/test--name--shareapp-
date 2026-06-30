"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useEffect, useState } from "react";

function useAppTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const read = () =>
      (document.documentElement.getAttribute("data-theme") as "dark" | "light") ||
      "dark";
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export default function ClerkProviderWithTheme({
  children,
  publishableKey,
}: {
  children: React.ReactNode;
  publishableKey: string;
}) {
  const theme = useAppTheme();
  const isDark = theme === "dark";

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={{
        theme: isDark ? dark : undefined,
        layout: {
          unsafe_disableDevelopmentModeWarnings: true,
        },
        variables: {
          colorPrimary: isDark ? "#7c6fff" : "#6c5ce7",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}