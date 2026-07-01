"use client";

import { useEffect, useState } from "react";

type BrandMarkProps = {
  className?: string;
  theme?: "dark" | "light";
};

export default function BrandMark({ className = "", theme }: BrandMarkProps) {
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(theme ?? "dark");

  useEffect(() => {
    if (theme) {
      setResolvedTheme(theme);
      return;
    }

    const syncTheme = () => {
      const attr = document.documentElement.getAttribute("data-theme");
      setResolvedTheme(attr === "light" ? "light" : "dark");
    };

    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [theme]);

  return (
    <img
      src={resolvedTheme === "light" ? "/brandmark-light.svg" : "/brandmark-dark.svg"}
      alt=""
      aria-hidden="true"
      className={`brand-mark ${className}`.trim()}
    />
  );
}
