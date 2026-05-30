"use client";

import { useEffect, useState } from "react";

export default function VideoBg() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "dark");
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme") || "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <video
        autoPlay
        muted
        loop
        playsInline
        key="dark"
        className="fixed inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-700"
        style={{ zIndex: 0, opacity: theme === "dark" ? 0.25 : 0 }}
      >
        <source src="/bg-dark.mp4" type="video/mp4" />
      </video>
      <video
        autoPlay
        muted
        loop
        playsInline
        key="light"
        className="fixed inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-700"
        style={{ zIndex: 0, opacity: theme === "light" ? 0.5 : 0 }}
      >
        <source src="/bg-light.mp4" type="video/mp4" />
      </video>
    </>
  );
}
