interface MetrixOutputDemand {
  notch?: "compact" | "minimal" | "expanded";
  tray: boolean;
  panel: boolean;
  widget: { known: boolean; families: Array<"small" | "medium" | "large"> };
}

interface MetrixPanelState {
  open: boolean;
  mode: "flyout" | "dialog" | "window" | null;
  source: string | null;
  alwaysOnTop: boolean;
  alwaysOnTopSupported: boolean;
  alwaysOnTopEffective: boolean | null;
}

interface MetrixInboxSummary {
  id: string;
  name: string;
  address: string;
  paused: boolean;
  message_count: number;
  last_received_at: number | null;
}

interface MetrixInboxItem {
  seq: number;
  inbox_id: string;
  source: string;
  received_at: number;
  size: number;
  subject: string;
  sender: string;
}

interface MetrixInboxMessage {
  subject: string;
  from: { name?: string; address: string }[];
  to: { name?: string; address: string }[];
  cc: { name?: string; address: string }[];
  date?: number;
  text: string;
  attachments: { name?: string; type: string; size: number }[];
  truncated?: boolean;
}

declare const $metrix: {
  readonly appVersion?: string;
  readonly platform?: "darwin" | "windows" | "linux" | "js";
  invalidate(): void;
  schedule(delayMs: number | null): void;
  log(...args: unknown[]): void;
  openURL(url: string): void;
  toast?(message: string): void;
  secret(name: string): string;
  outputs?: () => MetrixOutputDemand;
  subscription?: () => "free" | "plus";
  caniuse?: (name: string) => Promise<boolean>;
  system(command: "app.locale"): Promise<string>;
  readonly panel?: {
    open(): Promise<MetrixPanelState>;
    close(): Promise<MetrixPanelState>;
    toggle(): Promise<MetrixPanelState>;
    state(): Promise<MetrixPanelState>;
  };
  readonly notch?: {
    setState(state: "expanded" | "collapsed", options?: { durationMs?: number }): Promise<string>;
  };
  readonly inbox?: {
    boxes(): Promise<MetrixInboxSummary[]>;
    list(
      inboxId: string,
      options?: { limit?: number; before?: number },
    ): Promise<MetrixInboxItem[]>;
    read(inboxId: string, seq: number): Promise<Uint8Array>;
    message(inboxId: string, seq: number): Promise<MetrixInboxMessage>;
    remove(inboxId: string, seq: number): Promise<void>;
  };
};

interface Navigator {
  readonly languages?: readonly string[];
  readonly language?: string;
  clipboard: {
    writeText(text: string): Promise<void>;
  };
}

declare class Notification {
  constructor(title: string, options?: { body?: string; tag?: string; silent?: boolean });
  onclick: (() => void) | null;
  close(): void;
}
