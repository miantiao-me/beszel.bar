import prettyBytes from "pretty-bytes";
import { t, type Lang } from "../host/bridge.ts";
import type { Tone } from "../ui/kit.ts";
import { systemBandwidthBytes, systemLoad } from "./metrics.ts";
import type { Detail, SystemRecord, SystemStatus } from "./types.ts";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function finiteNonNeg(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatBinaryBytes(
  bytes: number,
  options: { compact?: boolean; maxDigits?: number } = {},
): string {
  const raw = prettyBytes(Math.max(0, bytes), {
    binary: true,
    space: !options.compact,
    ...(options.maxDigits !== undefined ? { maximumFractionDigits: options.maxDigits } : {}),
  });
  return options.compact ? raw.replace(/iB$/, "") : raw.replace(/iB$/, "B");
}

export function timestamp(value: string | number): number {
  if (typeof value === "number") return value;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

export function statusTone(status: SystemStatus): Tone {
  if (status === "up") return "success";
  if (status === "down") return "danger";
  if (status === "paused") return "muted";
  return "warning";
}

export function statusWord(status: SystemStatus, lang: Lang): string {
  if (status === "up") return t(lang, "在线", "up");
  if (status === "down") return t(lang, "离线", "down");
  if (status === "paused") return t(lang, "已暂停", "paused");
  return t(lang, "等待连接", "pending");
}

export function levelTone(value: number): Tone {
  if (value >= 90) return "danger";
  if (value >= 65) return "warning";
  return "success";
}

export function uptime(seconds: number | undefined, lang: Lang): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const mins = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return t(lang, `${days}天${hours}时`, `${days}d ${hours}h`);
  if (hours > 0) return t(lang, `${hours}时${mins}分`, `${hours}h ${mins}m`);
  return t(lang, `${Math.max(1, mins)}分钟`, `${Math.max(1, mins)}m`);
}

export function formatRate(bytesPerSec: number | null | undefined, compact = false): string {
  if (bytesPerSec === null || bytesPerSec === undefined || !Number.isFinite(bytesPerSec)) {
    return "—";
  }
  return `${formatBinaryBytes(bytesPerSec, { compact })}/s`;
}

/** Compact rate for the screen notch wing (e.g. "340K", "14.6M"). */
export function formatShortRate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec === null || bytesPerSec === undefined || !Number.isFinite(bytesPerSec)) {
    return "—";
  }
  return formatBinaryBytes(bytesPerSec, { compact: true, maxDigits: 1 });
}

export function scaleRateUnit(maxBytesPerSec: number): { unit: string; divisor: number } {
  if (maxBytesPerSec >= GB) return { unit: "GB/s", divisor: GB };
  if (maxBytesPerSec >= MB) return { unit: "MB/s", divisor: MB };
  if (maxBytesPerSec >= KB) return { unit: "KB/s", divisor: KB };
  return { unit: "B/s", divisor: 1 };
}

/** Beszel stores ContainerRecord.memory in MB. */
export function formatMemoryMb(mb: number | null | undefined): string {
  const valid = finiteNonNeg(mb);
  return valid === null ? "—" : formatBinaryBytes(valid * MB);
}

export function formatGb(gb: number | null | undefined): string {
  const valid = finiteNonNeg(gb);
  return valid === null ? "—" : formatBinaryBytes(valid * GB);
}

export function buildSystemSummaryText(
  system: SystemRecord,
  detail: Detail | null,
  lang: Lang,
): string {
  const info = system.info;
  const hw = detail?.details;
  const load = systemLoad(info);
  const bw = systemBandwidthBytes(info);
  return [
    `${system.name} (${statusWord(system.status, lang)})`,
    system.host || hw?.hostname || info?.h ? `Host: ${system.host || hw?.hostname || info?.h}` : "",
    info && system.status === "up"
      ? `CPU ${Math.round(info.cpu)}% | MEM ${Math.round(info.mp)}% | DISK ${Math.round(info.dp)}%`
      : "",
    bw !== null ? `Net: ${formatRate(bw)}` : "",
    load ? `Load: ${load.map((v) => v.toFixed(2)).join(" / ")}` : "",
    info?.u ? `Uptime: ${uptime(info.u, lang)}` : "",
    hw?.os_name || hw?.kernel || info?.k
      ? `OS: ${[hw?.os_name, hw?.kernel || info?.k].filter(Boolean).join(" · ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
