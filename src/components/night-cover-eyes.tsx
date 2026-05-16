import type { CSSProperties } from "react";

type CoverEye = {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: string;
  delay: string;
};

const coverEyes: CoverEye[] = [
  { x: 14.2, y: 14.5, w: 4.8, h: 5.6, r: "-2deg", delay: "0s" },
  { x: 28.1, y: 20.6, w: 4.2, h: 5.4, r: "8deg", delay: "0.46s" },
  { x: 69.4, y: 20.1, w: 5.2, h: 6.6, r: "2deg", delay: "0.93s" },
  { x: 21.7, y: 44.2, w: 4.6, h: 4.8, r: "-8deg", delay: "1.38s" },
  { x: 32.3, y: 49.1, w: 8.6, h: 8.9, r: "-2deg", delay: "1.86s" },
  { x: 68.5, y: 44.9, w: 9.5, h: 8.8, r: "2deg", delay: "2.31s" },
  { x: 13.2, y: 59.7, w: 5.2, h: 5.8, r: "3deg", delay: "2.87s" },
  { x: 18.7, y: 75.2, w: 5.6, h: 6.4, r: "0deg", delay: "3.42s" },
  { x: 84.4, y: 79.1, w: 6.1, h: 7.1, r: "-1deg", delay: "4.08s" }
];

export function NightCoverEyes() {
  return (
    <>
      {coverEyes.map((eye) => (
        <span
          key={`${eye.x}-${eye.y}`}
          className="night-cover-eye"
          style={
            {
              "--eye-x": `${eye.x}%`,
              "--eye-y": `${eye.y}%`,
              "--eye-w": `${eye.w}%`,
              "--eye-h": `${eye.h}%`,
              "--eye-r": eye.r ?? "0deg",
              "--blink-delay": eye.delay
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}
