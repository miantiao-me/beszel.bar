import { clamp } from "es-toolkit";
import { ICON_NAMES } from "./icons.ts";
import { h, T, type Child, type IconName, type Tone, type VNode } from "./kit.ts";

/** Aligned with henrygd/beszel internal/site/src/index.css & systems-table-columns.tsx. */
export const PAL = {
  blue: "#2662d9", // --chart-1: CPU, Disk Read, primary accent
  emerald: "#2eb88a", // --chart-2: Memory, Network Received
  orange: "#e88c30", // --chart-3: Disk Write
  purple: "#af57db", // --chart-4: Disk Usage
  rose: "#e23670", // --chart-5: Network Sent
  green: "#3db866", // Up / Good (< 65%)
  yellow: "#eab308", // Pending / Warn (65%-89%)
  red: "#ef4444", // Down / Crit (>= 90%)
  muted: "#71717a", // Paused / Muted
} as const;

export function cardClass(extra = ""): string {
  return `rounded-xl bg-surface border border-border ${extra}`.trim();
}

export function metricHex(value: number, normalHex: string = PAL.green): string {
  if (value >= 90) return PAL.red;
  if (value >= 65) return PAL.yellow;
  return normalHex;
}

/** Normal readings stay primary text color; warning/danger tints align with Beszel (65% / 90%). */
export function metricTextClass(value: number, active = true): string {
  if (!active) return "text-textMuted";
  if (value >= 90) return "text-[#ef4444]";
  if (value >= 65) return "text-[#eab308]";
  return "text-text";
}

export function toneColorHex(tone: Tone): string {
  if (tone === "danger") return PAL.red;
  if (tone === "warning") return PAL.yellow;
  if (tone === "success") return PAL.green;
  if (tone === "accent") return PAL.blue;
  return PAL.muted;
}

export function statusDot(hex: string, size = 7): VNode {
  return h("Box", {
    width: size,
    height: size,
    radius: size / 2,
    background: hex,
    tw: "shrink-0",
  });
}

export function hairline(): VNode {
  return h("Box", { tw: "w-full h-px bg-border shrink-0" });
}

export function slimBar(percent: number, colorHex: string, height = 4): VNode {
  const clamped = clamp(Number.isFinite(percent) ? percent : 0, 0, 100);
  return h(
    "Box",
    { height, fillWidth: true, radius: height / 2, background: "border" },
    clamped > 0
      ? h("Box", {
          absolute: true,
          top: 0,
          left: 0,
          height,
          radius: height / 2,
          widthPercent: Math.max(2, clamped),
          background: colorHex,
        })
      : null,
  );
}

export function ghostIconButton(
  name: IconName,
  onClick: () => void,
  options: {
    key?: string;
    tooltip: string;
    disabled?: boolean;
    active?: boolean;
    spinning?: boolean;
    size?: number;
    iconSize?: number;
    color?: string;
  },
): VNode {
  const size = options.size ?? 26;
  const iconSize = options.iconSize ?? 14;
  return h(
    "ButtonBase",
    {
      ...(options.key ? { key: options.key } : {}),
      width: size,
      height: size,
      center: true,
      label: options.tooltip,
      tooltip: options.tooltip,
      disabled: options.disabled ?? false,
      tw: `rounded-lg shrink-0 ${options.active ? "bg-surfacePressed" : ""} ${
        options.disabled
          ? "opacity-35"
          : "cursor-pointer hover:bg-surfaceHover active:bg-surfacePressed"
      }`,
      ...(options.disabled ? {} : { onClick }),
    },
    h("Icon", {
      name: ICON_NAMES[name],
      width: iconSize,
      height: iconSize,
      textColor: options.color ?? (options.active ? "text" : "textMuted"),
      ...(options.spinning
        ? {
            keyframes: {
              duration: 900,
              repeat: -1,
              ease: "linear",
              frames: [
                { at: 0, rotate: 0 },
                { at: 1, rotate: 360 },
              ],
            },
          }
        : {}),
    }),
  );
}

export function pill(text: string, hex: string, extra = ""): VNode {
  return T(text, {
    tw: `text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 text-[${hex}] bg-[${hex}1c] ${extra}`.trim(),
  });
}

export function kpiTile(options: {
  key: string;
  label: string;
  value: string;
  valueHex?: string;
  tintHex: string;
  sparkPoints?: { x: number; y: number }[];
  tooltip?: string;
}): VNode {
  return h(
    "Column",
    {
      key: options.key,
      tw: "grow basis-0 min-w-0 rounded-xl bg-surface border border-border px-2.5 py-2 gap-0.5",
      ...(options.tooltip ? { tooltip: options.tooltip } : {}),
    },
    T(options.label, { tw: "text-[10px] font-medium text-textMuted truncate" }),
    T(options.value, {
      tw: `text-[15px] font-bold tabular-nums leading-tight truncate ${
        options.valueHex ? `text-[${options.valueHex}]` : "text-text"
      }`,
    }),
    options.sparkPoints && options.sparkPoints.length > 1
      ? h("Chart", {
          type: "area",
          height: 16,
          tw: "w-full h-[16px]",
          curve: "monotone",
          axes: false,
          grid: false,
          legend: false,
          hover: false,
          appear: false,
          strokeWidth: 1.5,
          series: [
            { name: options.key, color: options.tintHex, fill: 0.2, points: options.sparkPoints },
          ],
        })
      : null,
  );
}

export function sectionHeading(title: string, trailing?: Child): VNode {
  return h(
    "Row",
    { tw: "items-center gap-2 w-full px-0.5 pt-1" },
    T(title, { tw: "text-[11px] font-semibold text-textMuted grow truncate" }),
    trailing ?? null,
  );
}
