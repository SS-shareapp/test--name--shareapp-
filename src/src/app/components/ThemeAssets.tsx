"use client";

import { useEffect } from "react";

function ensureIconLink() {
  let link = document.querySelector<HTMLLinkElement>("link[data-flock-icon]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.setAttribute("data-flock-icon", "true");
    document.head.appendChild(link);
  }
  return link;
}

export default function ThemeAssets() {
  useEffect(() => {
    const syncIcon = () => {
      const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      const link = ensureIconLink();
      link.href = theme === "dark" ? "/brandmark-dark.svg" : "/brandmark-light.svg";
    };

    syncIcon();
    const observer = new MutationObserver(syncIcon);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
