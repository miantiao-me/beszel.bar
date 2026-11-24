import { maxBy, orderBy } from "es-toolkit";
import { t, type Lang } from "../host/bridge.ts";
import type { Tone } from "../ui/kit.ts";
import type {
  AlertRecord,
  AttentionItem,
  Container,
  FleetSummary,
  SmartDevice,
  SortKey,
  StatsPoint,
  SystemInfo,
  SystemRecord,
  SystemStatus,
  SystemdService,
} from "./types.ts";

const MB = 1024 * 1024;

function finiteNonNeg(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function systemLoad(info: SystemInfo | undefined): [number, number, number] | null {
  if (!info) return null;
  if (Array.isArray(info.la) && info.la.length >= 3 && info.la.every(Number.isFinite)) {
    return [info.la[0], info.la[1], info.la[2]];
  }
  if (
    typeof info.l1 === "number" &&
    typeof info.l5 === "number" &&
    typeof info.l15 === "number" &&
    [info.l1, info.l5, info.l15].every(Number.isFinite)
  ) {
    return [info.l1, info.l5, info.l15];
  }
  return null;
}

export function systemBandwidthBytes(info: SystemInfo | undefined): number | null {
  if (!info) return null;
  const modern = finiteNonNeg(info.bb);
  if (modern !== null) return modern;
  const legacy = finiteNonNeg(info.b);
  return legacy !== null ? legacy * MB : null;
}

function bytePair(
  modern: [number, number] | undefined,
  legacyA: number | undefined,
  legacyB: number | undefined,
): [number | null, number | null] {
  if (Array.isArray(modern) && modern.length >= 2) {
    return [finiteNonNeg(Number(modern[0])), finiteNonNeg(Number(modern[1]))];
  }
  const a = finiteNonNeg(legacyA);
  const b = finiteNonNeg(legacyB);
  return [a !== null ? a * MB : null, b !== null ? b * MB : null];
}

export function statsBandwidthBytes(stats: StatsPoint["stats"] | undefined): {
  sent: number | null;
  recv: number | null;
} {
  if (!stats) return { sent: null, recv: null };
  const [sent, recv] = bytePair(stats.b, stats.ns, stats.nr);
  return { sent, recv };
}

export function statsDiskIoBytes(stats: StatsPoint["stats"] | undefined): {
  read: number | null;
  write: number | null;
} {
  if (!stats) return { read: null, write: null };
  const [read, write] = bytePair(stats.dio, stats.dr, stats.dw);
  return { read, write };
}

export function containerHealth(
  container: Container,
  lang: Lang,
): { tone: Tone; bad: boolean; label: string } {
  const status = (container.status || "").toLowerCase();
  if (container.health === 3 || status.includes("unhealthy")) {
    return { tone: "danger", bad: true, label: t(lang, "异常", "unhealthy") };
  }
  if (status.includes("exited") || status.includes("dead") || status.includes("restarting")) {
    return { tone: "danger", bad: true, label: container.status || t(lang, "停止", "stopped") };
  }
  if (container.health === 1 || status.includes("starting")) {
    return { tone: "warning", bad: true, label: t(lang, "启动中", "starting") };
  }
  if (container.health === 2 || status.includes("healthy")) {
    return { tone: "success", bad: false, label: t(lang, "健康", "healthy") };
  }
  if (status.startsWith("up") || status === "running") {
    return { tone: "success", bad: false, label: container.status || t(lang, "运行中", "running") };
  }
  return { tone: "muted", bad: false, label: container.status || "—" };
}

export function sortContainers(containers: Container[], lang: Lang): Container[] {
  return orderBy(
    containers,
    [(c) => (containerHealth(c, lang).bad ? 0 : 1), (c) => c.cpu ?? 0],
    ["asc", "desc"],
  );
}

export function isServiceFailed(service: SystemdService): boolean {
  const state = String(service.state ?? "").toLowerCase();
  const sub = String(service.sub ?? "").toLowerCase();
  // Beszel maps ServiceStatusFailed to 3 or "failed".
  return state === "failed" || state === "3" || sub === "failed";
}

export function isSmartBad(device: SmartDevice): boolean {
  const state = (device.state || "").toUpperCase();
  return state === "FAILED" || state === "FAILING" || state === "CRITICAL";
}

export function peakMetric(
  system: SystemRecord,
  lang: Lang,
): { dim: "cpu" | "mem" | "disk"; label: string; value: number } | null {
  const info = system.info;
  if (!info || system.status !== "up") return null;
  const metrics = [
    { dim: "cpu" as const, label: "CPU", value: info.cpu },
    { dim: "mem" as const, label: t(lang, "内存", "memory"), value: info.mp },
    { dim: "disk" as const, label: t(lang, "磁盘", "disk"), value: info.dp },
  ].filter((m) => Number.isFinite(m.value));
  return maxBy(metrics, (m) => m.value) ?? null;
}

export function summarizeFleet(systems: SystemRecord[]): FleetSummary {
  let up = 0;
  let down = 0;
  let pending = 0;
  let paused = 0;
  let cpuSum = 0;
  let memSum = 0;
  let liveCount = 0;
  let totalBandwidthBytes = 0;

  for (const s of systems) {
    if (s.status === "up") {
      up++;
      if (s.info) {
        if (Number.isFinite(s.info.cpu) && Number.isFinite(s.info.mp)) {
          cpuSum += s.info.cpu;
          memSum += s.info.mp;
          liveCount++;
        }
        const bw = systemBandwidthBytes(s.info);
        if (bw !== null) totalBandwidthBytes += bw;
      }
    } else if (s.status === "down") down++;
    else if (s.status === "pending") pending++;
    else paused++;
  }

  return {
    total: systems.length,
    up,
    down,
    pending,
    paused,
    avgCpu: liveCount > 0 ? cpuSum / liveCount : 0,
    avgMem: liveCount > 0 ? memSum / liveCount : 0,
    totalBandwidthBytes,
  };
}

export function sortSystems(list: SystemRecord[], sortKey: SortKey, desc: boolean): SystemRecord[] {
  const rank: Record<SystemStatus, number> = { down: 0, pending: 1, up: 2, paused: 3 };
  if (sortKey === "severity") {
    return orderBy(
      list,
      [
        (s) => {
          if (s.status === "up" && s.info) {
            const peak = Math.max(s.info.cpu, s.info.mp, s.info.dp);
            if (peak >= 90) return 0.5;
            if (peak >= 65) return 1.5;
          }
          return rank[s.status];
        },
        (s) => (s.status === "up" && s.info ? Math.max(s.info.cpu, s.info.mp, s.info.dp) : 0),
        (s) => s.name.toLowerCase(),
      ],
      ["asc", "desc", "asc"],
    );
  }
  return orderBy(
    list,
    [
      (s) => (s.status === "up" ? 0 : 1),
      (s) => {
        if (sortKey === "name") return s.name.toLowerCase();
        if (s.status !== "up" || !s.info) return -1;
        if (sortKey === "cpu") return s.info.cpu;
        if (sortKey === "mem") return s.info.mp;
        if (sortKey === "disk") return s.info.dp;
        return systemBandwidthBytes(s.info) ?? -1;
      },
      (s) => s.name.toLowerCase(),
    ],
    ["asc", desc ? "desc" : "asc", "asc"],
  );
}

function alertMetricDimension(name: string): "cpu" | "mem" | "disk" | "status" | "" {
  const lower = name.toLowerCase();
  if (lower.includes("status") || lower.includes("offline") || lower.includes("down")) {
    return "status";
  }
  if (lower.includes("cpu")) return "cpu";
  if (lower.includes("mem")) return "mem";
  if (lower.includes("disk")) return "disk";
  return "";
}

export function buildAttention(
  systems: SystemRecord[],
  alerts: AlertRecord[],
  threshold: number,
  lang: Lang,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const byId = new Map(systems.map((s) => [s.id, s]));
  const offlineIds = new Set<string>();
  const alertedDims = new Set<string>();

  for (const s of systems) {
    if (s.status === "down") {
      offlineIds.add(s.id);
      items.push({
        id: `offline-${s.id}`,
        kind: "offline",
        severity: "critical",
        title: s.name,
        detail: t(lang, "离线", "Down"),
        systemId: s.id,
      });
    }
  }

  for (const a of alerts) {
    if (!a.triggered) continue;
    const dim = alertMetricDimension(a.name);
    if (dim === "status" && offlineIds.has(a.system)) continue;
    if (dim) alertedDims.add(`${a.system}:${dim}`);

    const host = byId.get(a.system);
    const liveVal =
      host?.status === "up" && host.info
        ? dim === "cpu"
          ? host.info.cpu
          : dim === "mem"
            ? host.info.mp
            : dim === "disk"
              ? host.info.dp
              : undefined
        : undefined;
    const detail =
      liveVal !== undefined && Number.isFinite(liveVal)
        ? `${Math.round(liveVal)}%`
        : a.value !== undefined
          ? `≥ ${a.value}`
          : t(lang, "告警", "Alert");

    items.push({
      id: `alert-${a.id}`,
      kind: "alert",
      severity: "critical",
      title: `${host?.name ?? a.system} · ${a.name}`,
      detail,
      systemId: a.system,
    });
  }

  if (threshold > 0) {
    for (const s of systems) {
      const peak = peakMetric(s, lang);
      if (!peak || peak.value < threshold || alertedDims.has(`${s.id}:${peak.dim}`)) continue;
      items.push({
        id: `threshold-${s.id}`,
        kind: "threshold",
        severity: peak.value >= 90 ? "critical" : "warning",
        title: `${s.name} · ${peak.label}`,
        detail: `${Math.round(peak.value)}%`,
        systemId: s.id,
      });
    }
  }

  for (const s of systems) {
    if (s.status === "up" && s.info?.sv && s.info.sv[1] > 0) {
      items.push({
        id: `service-${s.id}`,
        kind: "service",
        severity: "warning",
        title: `${s.name} · Systemd`,
        detail: t(lang, `${s.info.sv[1]} 失败`, `${s.info.sv[1]} failed`),
        systemId: s.id,
      });
    }
    if (s.status === "pending") {
      items.push({
        id: `pending-${s.id}`,
        kind: "pending",
        severity: "warning",
        title: s.name,
        detail: t(lang, "等待连接", "Pending"),
        systemId: s.id,
      });
    }
  }

  return items;
}
