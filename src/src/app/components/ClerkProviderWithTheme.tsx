"use client";

import { ClerkProvider } from "@clerk/nextjs";
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
        layout: {
          unsafe_disableDevelopmentModeWarnings: true,
        },
        variables: isDark
          ? {
              colorBackground: "#080818",
              colorInputBackground: "#04040f",
              colorText: "#f4f2ff",
              colorTextSecondary: "rgba(244, 242, 255, 0.45)",
              colorPrimary: "#7c6fff",
              colorDanger: "#ff6b9d",
            }
          : {
              colorBackground: "#f7f6ff",
              colorInputBackground: "#ffffff",
              colorText: "#160d3a",
              colorTextSecondary: "#8577a8",
              colorPrimary: "#6c5ce7",
              colorDanger: "#f97066",
            },
      }}
    >
      {children}
    </ClerkProvider>
  );
}