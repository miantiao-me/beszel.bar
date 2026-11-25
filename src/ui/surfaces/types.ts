import type {
  AttentionItem,
  Detail,
  ErrorKind,
  FleetSample,
  FleetSummary,
  NotchMetric,
  SystemRecord,
  TrayFormat,
  WidgetMode,
} from "../../beszel/types.ts";
import type { Capabilities, Lang } from "../../host/bridge.ts";
import type { InboxAlert } from "../../inbox/parser.ts";
import type { Tone, VNode } from "../kit.ts";

export interface View {
  tray?: Record<string, unknown>;
  panel?: VNode;
  notch?: Record<string, unknown>;
  widget?: Record<string, VNode>;
}

export interface SurfaceContext {
  lang: Lang;
  configured: boolean;
  serverUrl: string;
  systems: SystemRecord[];
  fleetSummary: FleetSummary;
  attentionItems: AttentionItem[];
  fleetHistory: FleetSample[];
  inboxAlerts: InboxAlert[];
  inboxUnreadKeys: ReadonlySet<string>;
  stale: boolean;
  errorKind: ErrorKind;
  errorMessage: string;
  verdictText: string;
  verdictTone: Tone;
  trayFormat: TrayFormat;
  notchMetric: NotchMetric;
  activeNotchActivity: { id: string; expiresAt: number } | null;
  widgetMode: WidgetMode;
  widgetSystem: string;
  selectedSystemId: string | null;
  detail: Detail | null;
  caps: Pick<
    Capabilities,
    "trayContent" | "trayContentIcon" | "notch" | "notchActivity" | "widgetChart"
  >;
  onRefresh: () => void;
  onOpenBeszel: () => void;
  onOpenSystem: (id: string) => void;
}

export type SurfaceData = Omit<SurfaceContext, "onRefresh" | "onOpenBeszel" | "onOpenSystem">;
