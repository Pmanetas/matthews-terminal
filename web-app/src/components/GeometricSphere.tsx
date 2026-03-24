import { useEffect, useCallback, useRef } from "react";

const CONFIG = {
  primaryColor: "139, 92, 246",
  secondaryColor: "59, 130, 246",
  coreBlur: 200,
  wireframeOpacity: 0.75,
  wireframeShadowIntensity: 70,
  sphereDensity: 12,
  lerpFactor: 0.08,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface GeometricSphereProps {
  isActive?: boolean;
  size?: number;
}

export function GeometricSphere({ isActive = false, size = 400 }: GeometricSphereProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const targetMouse = useRef({ x: 0, y: 0 });
  const currentMouse = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  // Smooth mouse parallax via rAF — no React state, no re-renders
  const tick = useCallback(() => {
    currentMouse.current.x = lerp(currentMouse.current.x, targetMouse.current.x, CONFIG.lerpFactor);
    currentMouse.current.y = lerp(currentMouse.current.y, targetMouse.current.y, CONFIG.lerpFactor);

    const el = wrapperRef.current;
    if (el) {
      const rotX = currentMouse.current.y * 5;
      const rotY = -currentMouse.current.x * 5;
      el.style.setProperty("--tilt-x", `${rotX}deg`);
      el.style.setProperty("--tilt-y", `${rotY}deg`);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      targetMouse.current = { x: (e.clientX - cx) / cx, y: (e.clientY - cy) / cy };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Pre-generate ring transforms (static, never changes)
  const rings = useRef(
    Array.from({ length: CONFIG.sphereDensity }, (_, i) => {
      const step = 90 / (CONFIG.sphereDensity / 2);
      const angle = i * step;
      return i % 2 === 0 ? `rotateY(${angle}deg)` : `rotateX(${angle}deg)`;
    })
  ).current;

  return (
    <div
      ref={wrapperRef}
      className={`sphere-wrapper ${isActive ? "sphere-active" : ""}`}
      style={{ width: size, height: size } as React.CSSProperties}
    >
      {/* Core glow — transitions via CSS class */}
      <div className="sphere-core-light" />

      {/* Wireframe — always spinning, speed controlled by CSS class */}
      <div className="sphere-spin-container">
        {rings.map((transform, i) => (
          <div
            key={i}
            className="sphere-wireframe-line"
            style={{ transform }}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Pulse ring — only rendered when active, CSS handles animation */}
      <div className="sphere-pulse-ring" />
      <div className="sphere-pulse-ring sphere-pulse-ring-delayed" />
    </div>
  );
}
