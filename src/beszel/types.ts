export type SystemStatus = "up" | "down" | "paused" | "pending";
export type PeriodKey = "1h" | "12h" | "24h" | "7d";
export type MetricTab = "CPU" | "MEM" | "NET" | "DISK";
export type SortKey = "severity" | "cpu" | "mem" | "disk" | "net" | "name";
export type TrayFormat = "online_rate" | "online" | "cpu" | "rate_spark" | "cpu_spark";
export type NotchMetric = "online" | "cpu" | "rate";
export type WidgetMode = "overview" | "system" | "alerts";
export type ErrorKind = "" | "config" | "auth" | "connect" | "http";

export const PERIODS: Record<
  PeriodKey,
  { ms: number; type: string; perPage: number; labelZh: string; labelEn: string }
> = {
  "1h": { ms: 3_600_000, type: "1m", perPage: 120, labelZh: "1小时", labelEn: "1h" },
  "12h": { ms: 43_200_000, type: "10m", perPage: 120, labelZh: "12小时", labelEn: "12h" },
  "24h": { ms: 86_400_000, type: "20m", perPage: 120, labelZh: "24小时", labelEn: "24h" },
  "7d": { ms: 604_800_000, type: "120m", perPage: 120, labelZh: "7天", labelEn: "7d" },
};

export interface SystemInfo {
  h?: string;
  cpu: number;
  mp: number;
  dp: number;
  u?: number;
  la?: [number, number, number];
  l1?: number;
  l5?: number;
  l15?: number;
  c?: number;
  t?: number;
  m?: string;
  o?: string;
  os?: string | number;
  k?: string;
  sv?: [number, number];
  /** Legacy bandwidth in MB/s. */
  b?: number;
  /** Modern bandwidth in bytes/s. */
  bb?: number;
  /** Highest GPU utilization percent. */
  g?: number;
  /** Dashboard display temperature in Celsius. */
  dt?: number;
  /** Agent version. */
  v?: string;
  /** Uses Podman instead of Docker. */
  p?: boolean;
}

export interface SystemRecord {
  id: string;
  name: string;
  host?: string;
  port?: string;
  status: SystemStatus;
  info?: SystemInfo;
  updated?: string;
}

export interface SystemDetailsRecord {
  id?: string;
  system?: string;
  hostname?: string;
  kernel?: string;
  cores?: number;
  threads?: number;
  cpu?: string;
  os_name?: string;
  arch?: string;
  memory?: number;
  podman?: boolean;
}

export interface StatsPoint {
  created: string | number;
  stats: {
    cpu?: number;
    mp?: number;
    dp?: number;
    /** Memory total / used in GB. */
    m?: number;
    mu?: number;
    /** Disk total / used in GB. */
    d?: number;
    du?: number;
    /** Legacy network sent / received in MB/s. */
    ns?: number;
    nr?: number;
    /** Modern bandwidth [sentBytes, recvBytes] per second. */
    b?: [number, number];
    /** Legacy disk read / write in MB/s. */
    dr?: number;
    dw?: number;
    /** Modern disk I/O [readBytes, writeBytes] per second. */
    dio?: [number, number];
    t?: Record<string, number>;
    g?: Record<string, { n?: string; u?: number; mu?: number; mt?: number }>;
  };
}

export interface Container {
  id: string;
  name: string;
  image?: string;
  status?: string;
  cpu?: number;
  /** Beszel stores ContainerRecord.memory in MB. */
  memory?: number;
  net?: number;
  /** 0 = None, 1 = Starting, 2 = Healthy, 3 = Unhealthy. */
  health?: number;
}

export interface SystemdService {
  id?: string;
  name: string;
  state?: string | number;
  sub?: string | number;
  cpu?: number;
  memory?: number;
}

export interface SmartDevice {
  id?: string;
  name: string;
  model?: string;
  state?: string;
  temp?: number;
}

export interface AlertRecord {
  id: string;
  system: string;
  name: string;
  triggered?: boolean;
  value?: number;
  min?: number;
}

export interface Detail {
  id: string;
  period: PeriodKey;
  points: StatsPoint[];
  details: SystemDetailsRecord | null;
  containers: Container[];
  services: SystemdService[];
  smartDevices: SmartDevice[];
  error: string;
  loadedAt: number;
}

export interface FleetSample {
  ts: number;
  avgCpu: number;
  bandwidthBytes: number;
}

export interface FleetSummary {
  total: number;
  up: number;
  down: number;
  pending: number;
  paused: number;
  avgCpu: number;
  avgMem: number;
  totalBandwidthBytes: number;
}

export interface AttentionItem {
  id: string;
  kind: "offline" | "alert" | "threshold" | "service" | "pending";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  systemId: string;
}
