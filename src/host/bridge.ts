import { destr } from "destr";

export type Lang = "zh" | "en";

export interface Env {
  inputs: Record<string, unknown>;
  reason?: string;
  viewport?: {
    width: number;
    height: number;
    titleBar: { height: number; left: number; right: number };
  };
}

export interface OutputDemand extends MetrixOutputDemand {
  known: boolean;
}

export interface Capabilities {
  trayContent: boolean;
  trayContentIcon: boolean;
  notch: boolean;
  notchActivity: boolean;
  notchSetState: boolean;
  widgetChart: boolean;
  inboxBoxes: boolean;
  inboxList: boolean;
  inboxMessage: boolean;
  inboxRemove: boolean;
}

export const DEFAULT_DEMAND: OutputDemand = {
  known: false,
  tray: true,
  panel: true,
  notch: undefined,
  widget: { known: false, families: [] },
};

export const DEFAULT_CAPS: Capabilities = {
  trayContent: false,
  trayContentIcon: false,
  notch: false,
  notchActivity: false,
  notchSetState: false,
  widgetChart: false,
  inboxBoxes: false,
  inboxList: false,
  inboxMessage: false,
  inboxRemove: false,
};

const CAP_MAP: [keyof Capabilities, string][] = [
  ["trayContent", "render.tray.content"],
  ["trayContentIcon", "render.tray.content.icon"],
  ["notch", "render.notch"],
  ["notchActivity", "render.notch.activity"],
  ["notchSetState", "notch.setState"],
  ["widgetChart", "render.widget.chart"],
  ["inboxBoxes", "inbox.boxes"],
  ["inboxList", "inbox.list"],
  ["inboxMessage", "inbox.message"],
  ["inboxRemove", "inbox.remove"],
];

const INBOX_CAP_MAP = CAP_MAP.filter(([key]) => key.startsWith("inbox"));

export function langOf(env: Env | null | undefined): Lang {
  const value = env?.inputs.lang;
  if (value === "zh" || value === "en") return value;
  const nav = globalThis.navigator as
    | { languages?: readonly string[]; language?: string }
    | undefined;
  const tags = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const tag of tags) {
    const lower = String(tag).toLowerCase();
    if (lower.startsWith("zh")) return "zh";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}

export function t(lang: Lang, zh: string, en: string): string {
  return lang === "zh" ? zh : en;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Single safe boundary for optional host APIs so business logic stays free of defensive try/catch.
function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function readSecret(name: "email" | "password"): string {
  return safeCall(() => $metrix.secret(name), "");
}

export function readOutputDemand(): OutputDemand {
  return safeCall(() => {
    const d = $metrix.outputs?.();
    return d ? { known: true, ...d } : DEFAULT_DEMAND;
  }, DEFAULT_DEMAND);
}

export function isPlusHost(): boolean {
  return safeCall(() => $metrix.subscription?.() === "plus", false);
}

export function invalidateHost(): void {
  safeCall(() => $metrix.invalidate(), undefined);
}

export function scheduleHost(delayMs: number): void {
  safeCall(() => $metrix.schedule(delayMs), undefined);
}

export function toastHost(message: string): void {
  safeCall(() => $metrix.toast?.(message), undefined);
}

export function logHost(...args: unknown[]): void {
  safeCall(() => $metrix.log(...args), undefined);
}

export function openHostPanel(): void {
  void $metrix.panel?.open().catch(() => {});
}

export function expandHostNotch(durationMs = 6000): void {
  void $metrix.notch?.setState("expanded", { durationMs }).catch(() => {});
}

export function openHostUrl(url: string): void {
  $metrix.openURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function sendHostNotification(
  title: string,
  body: string,
  tag: string,
  onClick: () => void,
): boolean {
  if (typeof Notification === "undefined") return false;
  return safeCall(() => {
    const notification = new Notification(title, { body, tag });
    notification.onclick = onClick;
    return true;
  }, false);
}

export function readStorage<T>(key: string, fallback: T): T {
  return safeCall(() => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = destr<T | null>(raw);
    return parsed ?? fallback;
  }, fallback);
}

export function writeStorage(key: string, value: unknown): void {
  safeCall(() => localStorage.setItem(key, JSON.stringify(value)), undefined);
}

export async function probeCapabilities(
  prev: Capabilities,
  scope: "all" | "inbox" = "all",
): Promise<Capabilities> {
  const check = $metrix.caniuse;
  if (typeof check !== "function") return prev;
  const entries = scope === "inbox" ? INBOX_CAP_MAP : CAP_MAP;
  const results = await Promise.all(entries.map(([, cap]) => check(cap).catch(() => false)));
  const next = { ...prev };
  entries.forEach(([key], i) => {
    next[key] = results[i] ?? false;
  });
  return next;
}
