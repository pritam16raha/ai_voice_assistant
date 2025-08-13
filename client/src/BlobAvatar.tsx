import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

type BlobAvatarProps = {
  activity: number;
  title?: string;
  subtitle?: string;
  sizeVmin?: number;
};

export default function BlobAvatar({
  activity,
  title = `Hi, I'm Alva`,
  subtitle = "an AI  Assistant",
  sizeVmin = 60,
}: BlobAvatarProps) {
  const [seed, setSeed] = useState<number>(1);

  useEffect(() => {
    let raf: number = 0;
    const t0: number = performance.now();

    const tick = () => {
      const t: number = performance.now() - t0;
      const s: number = 1 + Math.floor((t / 1200) % 6);
      setSeed(s);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const disp: number = 20 + activity * 110;
  const base: number = 0.0025 + activity * 0.002;
  const scale: number = 1 + activity * 0.35;

  const box: string = `${sizeVmin}vmin`;

  const containerStyle: React.CSSProperties = { width: box, height: box };
  const auraStyle: React.CSSProperties = {
    background:
      "radial-gradient(60% 60% at 50% 50%, rgba(56,189,248,0.18), rgba(217,70,239,0.12), transparent)",
  };

  return (
    <div className="relative grid place-items-center" style={containerStyle}>
      <motion.div
        className="absolute inset-0"
        animate={{ scale }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
      >
        <svg viewBox="0 0 600 600" className="w-full h-full">
          <defs>
            <radialGradient id="rv-grad" cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor="#7dd3fc" />
              <stop offset="60%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#d946ef" />
            </radialGradient>

            <filter id="rv-blob" x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={base}
                numOctaves={2}
                seed={seed}
                result="noise"
              />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={disp} />
            </filter>
          </defs>

          <g filter="url(#rv-blob)">
            <circle cx={300} cy={300} r={220} fill="url(#rv-grad)" />
          </g>
        </svg>
      </motion.div>

      <div className="absolute text-center select-none">
        <div className="text-4xl md:text-5xl font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
          {title}
        </div>
        <div className="mt-3 text-[12px] uppercase tracking-[0.22em] text-white/80 bg-white/10 px-3 py-1 rounded-full backdrop-blur">
          {subtitle}
        </div>
      </div>

      <div
        className="absolute -z-10 w-[120%] h-[120%] rounded-full blur-3xl"
        style={auraStyle}
      />
    </div>
  );
}
