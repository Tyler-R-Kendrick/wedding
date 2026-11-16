// Ported from open-intelligent-ui (thesysdev), MIT licence; the notice is in ./LICENSE-open-intelligent-ui.txt.
import { defineFunction } from "@openuidev/react-lang";
import { z } from "zod/v4";

const HEX = /^#?([\da-f]{3}|[\da-f]{6})$/i;

function channels(color: string): number[] {
  const m = HEX.exec(color.trim());
  if (!m) throw new Error(`not a hex color: ${color}`);
  const raw = m[1] ?? "";
  const hex = raw.length === 3 ? raw.replace(/./g, "$&$&") : raw;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export const MixColor = defineFunction({
  name: "MixColor",
  description: 'The hex color a fraction t of the way from one hex color to another, e.g. @MixColor("#ffffff", "#0285ff", 0.5) for a heatmap or a tint',
  params: z.object({ from: z.string(), to: z.string(), t: z.number() }),
  returns: z.string(),
  fn: ({ from, to, t }) => {
    const a = channels(from);
    const b = channels(to);
    const k = Math.min(1, Math.max(0, t));
    return `#${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * k).toString(16).padStart(2, "0")).join("")}`;
  },
});

export const colorFunctions = [MixColor];
