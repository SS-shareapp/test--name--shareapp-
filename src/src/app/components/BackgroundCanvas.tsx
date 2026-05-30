"use client";

import { useEffect, useRef } from "react";

interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  size: number;
  wingAngle: number;
  wingSpeed: number;
  opacity: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  baseOpacity: number;
  twinkleOffset: number;
  twinkleSpeed: number;
}

export default function BackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const themeRef = useRef("dark");

  useEffect(() => {
    // Watch for theme changes
    const observer = new MutationObserver(() => {
      themeRef.current = document.documentElement.getAttribute("data-theme") || "dark";
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    themeRef.current = document.documentElement.getAttribute("data-theme") || "dark";

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const handleMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouse);

    // Stars
    const stars: Star[] = Array.from({ length: 120 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.5,
      baseOpacity: Math.random() * 0.3 + 0.05,
      twinkleOffset: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.005 + Math.random() * 0.015,
    }));

    // Birds (boids-lite)
    const birds: Bird[] = Array.from({ length: 45 }, () => ({
      x: Math.random() * (canvas!.width + 200) - 100,
      y: Math.random() * canvas!.height * 0.8 + 50,
      vx: 0.5 + Math.random() * 1.0,
      vy: (Math.random() - 0.5) * 0.4,
      speed: 0.6 + Math.random() * 1.0,
      size: 0.5 + Math.random() * 1.0,
      wingAngle: Math.random() * Math.PI * 2,
      wingSpeed: 0.04 + Math.random() * 0.05,
      opacity: 0.2 + Math.random() * 0.5,
    }));

    let time = 0;
    let animId: number;

    function draw() {
      time++;
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      // Aurora blobs
      const t = time * 0.003;
      const isLight = themeRef.current === "light";
      const blobs = [
        { cx: w * (0.3 + 0.15 * Math.sin(t)), cy: h * (0.35 + 0.1 * Math.cos(t * 0.7)), r: w * 0.35, hue: 260 },
        { cx: w * (0.7 + 0.1 * Math.cos(t * 0.8)), cy: h * (0.5 + 0.12 * Math.sin(t * 0.6)), r: w * 0.3, hue: 200 },
        { cx: w * (0.5 + 0.12 * Math.sin(t * 1.1)), cy: h * (0.3 + 0.08 * Math.cos(t * 0.9)), r: w * 0.25, hue: 290 },
      ];
      for (const blob of blobs) {
        const grad = ctx!.createRadialGradient(blob.cx, blob.cy, 0, blob.cx, blob.cy, blob.r);
        const opacity = isLight ? 0.07 : 0.06;
        grad.addColorStop(0, `hsla(${blob.hue}, ${isLight ? 60 : 70}%, ${isLight ? 60 : 50}%, ${opacity})`);
        grad.addColorStop(1, `hsla(${blob.hue}, 70%, 50%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.fillRect(0, 0, w, h);
      }

      // Stars
      for (const star of stars) {
        star.twinkleOffset += star.twinkleSpeed;
        const opacity = star.baseOpacity * (0.5 + 0.5 * Math.sin(star.twinkleOffset));
        ctx!.beginPath();
        ctx!.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
        ctx!.fillStyle = isLight
          ? `hsla(252, 60%, 65%, ${opacity * 0.6})`
          : `rgba(220, 215, 255, ${opacity})`;
        ctx!.fill();
      }

      // Birds with mouse avoidance
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (const bird of birds) {
        // Mouse repulsion
        const dx = bird.x - mx;
        const dy = bird.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120 && dist > 0) {
          const force = (120 - dist) / 120;
          bird.vx += (dx / dist) * force * 0.3;
          bird.vy += (dy / dist) * force * 0.3;
        }

        // Tendency to fly right
        bird.vx += (bird.speed - bird.vx) * 0.02;
        bird.vy *= 0.98;
        bird.vy += (Math.sin(time * 0.01 + bird.wingAngle) * 0.02);

        // Clamp velocity
        const maxV = bird.speed * 2.5;
        const vel = Math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy);
        if (vel > maxV) {
          bird.vx = (bird.vx / vel) * maxV;
          bird.vy = (bird.vy / vel) * maxV;
        }

        bird.x += bird.vx;
        bird.y += bird.vy;
        bird.wingAngle += bird.wingSpeed;

        // Reset when exiting right
        if (bird.x > w + 60) {
          bird.x = -60;
          bird.y = Math.random() * h * 0.8 + 50;
          bird.vx = bird.speed;
          bird.vy = (Math.random() - 0.5) * 0.4;
        }

        // Keep in vertical bounds
        if (bird.y < 20) bird.vy += 0.1;
        if (bird.y > h - 20) bird.vy -= 0.1;

        // Draw bird as two wing arcs
        const s = bird.size;
        const wingY = Math.sin(bird.wingAngle) * 10 * s;
        ctx!.save();
        ctx!.translate(bird.x, bird.y);
        ctx!.globalAlpha = bird.opacity;
        ctx!.strokeStyle = isLight ? "rgba(22, 13, 58, 1)" : "rgba(210, 200, 255, 1)";
        ctx!.lineWidth = 1.2 * s;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(0, 0);
        ctx!.quadraticCurveTo(-14 * s, wingY, -24 * s, wingY * 0.5);
        ctx!.moveTo(0, 0);
        ctx!.quadraticCurveTo(14 * s, wingY, 24 * s, wingY * 0.5);
        ctx!.stroke();
        ctx!.restore();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouse);
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
    />
  );
}
