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

  const isDark = theme === "dark";
  const videoSrc = isDark
    ? "https://uym109j6qu.ufs.sh/f/gQJ4jJp8taelMokIXCD2CDdotW8JUhuYwKv5LqP1cORaegpF"
    : "https://uym109j6qu.ufs.sh/f/gQJ4jJp8taelo0TPnvSPiptqYM2arGwLXkhQ9HAuVfKnDR4B";
  const opacity = isDark ? 0.25 : 0.5;

  return (
    <video
      key={theme}
      autoPlay
      muted
      loop
      playsInline
      className="fixed inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-700"
      style={{ zIndex: 0, opacity }}
    >
      <source src={videoSrc} type="video/webm" />
    </video>
  );
}
