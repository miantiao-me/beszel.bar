import { h as vueH, type VNode } from "vue";
import { t, type Lang } from "../host/bridge.ts";
import { ICON_NAMES, type IconName } from "./icons.ts";

export type { IconName, VNode };
export type Tone = "success" | "warning" | "danger" | "accent" | "muted";
export type Child = VNode | string | number | boolean | null | undefined;

export interface Status {
  text: string;
  tone?: Tone;
}

export function h(
  type: string,
  props?: Record<string, unknown> | null,
  ...children: (Child | Child[])[]
): VNode {
  const flat = children
    .flat()
    .filter(
      (child): child is VNode | string | number =>
        child !== null && child !== undefined && child !== false && child !== true,
    );
  return vueH(type, props ?? null, flat.length ? flat : undefined);
}

export function T(text: string, props: Record<string, unknown> = {}): VNode {
  return h("Text", { text, ...props });
}

export function Icon(name: IconName, size = 14, color?: string): VNode {
  return h("Icon", {
    name: ICON_NAMES[name],
    width: size,
    height: size,
    ...(color ? { textColor: color } : {}),
  });
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ago(ts: number, lang: Lang): string {
  if (!ts) return t(lang, "从未", "never");
  const seconds = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const later = seconds > 0;
  if (abs < 45) return t(lang, "刚刚", "just now");
  const [value, zh, en] =
    abs < 3600
      ? [Math.round(abs / 60), "分钟", "min"]
      : abs < 86_400
        ? [Math.round(abs / 3600), "小时", "hr"]
        : [Math.round(abs / 86_400), "天", "days"];
  return lang === "zh"
    ? `${value} ${zh}${later ? "后" : "前"}`
    : `${value} ${en} ${later ? "from now" : "ago"}`;
}

export function splitSeries(
  points: { x: number; y: number | null }[],
): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.y !== null && Number.isFinite(point.y)) current.push({ x: point.x, y: point.y });
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}
