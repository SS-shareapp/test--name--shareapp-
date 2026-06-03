"use client";

import { useEffect, useRef } from "react";

export default function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mx = 0,
      my = 0,
      rx = 0,
      ry = 0;
    let animationFrameId: number;

    const handleMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    document.addEventListener("mousemove", handleMove);

    function animate() {
      // Lerp for ring trailing
      rx += (mx - rx) * 0.13;
      ry += (my - ry) * 0.13;

      if (dotRef.current) {
        dotRef.current.style.left = `${mx}px`;
        dotRef.current.style.top = `${my}px`;
      }
      if (ringRef.current) {
        ringRef.current.style.left = `${rx}px`;
        ringRef.current.style.top = `${ry}px`;
      }
      animationFrameId = requestAnimationFrame(animate);
    }
    animate();

    // Hover detection for interactive elements
    const addHover = () => ringRef.current?.classList.add("hover");
    const removeHover = () => ringRef.current?.classList.remove("hover");

    const observer = new MutationObserver(() => {
      bindHoverables();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function bindHoverables() {
      const els = document.querySelectorAll(
        "a, button, [data-hover], .drop-zone, .feat-card, .price-card, input"
      );
      els.forEach((el) => {
        el.removeEventListener("mouseenter", addHover);
        el.removeEventListener("mouseleave", removeHover);
        el.addEventListener("mouseenter", addHover);
        el.addEventListener("mouseleave", removeHover);
      });
    }
    bindHoverables();

    return () => {
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener("mousemove", handleMove);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" />
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
}
