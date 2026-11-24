import { delay } from "es-toolkit";
import { errorText, logHost, t, toastHost, type Capabilities, type Lang } from "../host/bridge.ts";
import type { SystemRecord } from "../beszel/types.ts";
import {
  classifyInboxSeverity,
  matchSystemForText,
  parseInboxContent,
  type InboxAlert,
} from "./parser.ts";

const PREWARM_COUNT = 3;
const MAX_STORED_ALERTS = 40;

export type InboxItemOp = "loading" | "deleting";

export interface InboxServiceHooks {
  getLang: () => Lang;
  getCaps: () => Capabilities;
  syncInboxCaps: () => Promise<Capabilities>;
  getSystems: () => SystemRecord[];
  getAlerts: () => InboxAlert[];
  setAlerts: (alerts: InboxAlert[]) => void;
  setBoundCount: (count: number) => void;
  getReadKeys: () => ReadonlySet<string>;
  deleteReadKey: (key: string) => void;
  getExpandedKey: () => string | null;
  setExpandedKey: (key: string | null) => void;
  getBusyMap: () => Record<string, InboxItemOp>;
  setItemBusy: (key: string, op: InboxItemOp | null) => void;
  onNewAlert: (alert: InboxAlert) => void;
}

// Host enforces max 2 concurrent inbox calls; briefly back off when another call is finishing.
async function withBusyRetry<T>(fn: () => Promise<T>, backoffMs: number): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (errorText(err).toLowerCase().includes("busy") && attempt < 2) {
        await delay(backoffMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error("inbox busy");
}

/** Explicit Plus Inbox sync, sequential prewarm, body load, and busy-safe delete service. */
export function createInboxService(hooks: InboxServiceHooks) {
  let lastRefreshAt = 0;
  let refreshGen = 0;
  let prewarming = false;

  const isDeleting = (key: string) => hooks.getBusyMap()[key] === "deleting";
  const hasBusyItem = () => Object.keys(hooks.getBusyMap()).length > 0;

  function reset(): void {
    refreshGen++;
    lastRefreshAt = 0;
    prewarming = false;
  }

  function isStale(maxAgeMs: number): boolean {
    return lastRefreshAt === 0 || Date.now() - lastRefreshAt > maxAgeMs;
  }

  async function loadBody(item: InboxAlert, options: { silent?: boolean } = {}): Promise<void> {
    if (item.loaded || !hooks.getCaps().inboxMessage || !$metrix.inbox) return;
    if (!options.silent) hooks.setItemBusy(item.key, "loading");
    try {
      const msg = await withBusyRetry(() => $metrix.inbox!.message(item.inboxId, item.seq), 300);
      const parsed = parseInboxContent(msg.text || "", item.title, Boolean(item.fallbackTitle));
      const matched = matchSystemForText(`${parsed.title} ${parsed.body}`, hooks.getSystems());
      hooks.setAlerts(
        hooks.getAlerts().map((a) =>
          a.key === item.key
            ? {
                ...a,
                title: parsed.title,
                fallbackTitle: false,
                body: parsed.body,
                severity: classifyInboxSeverity(`${parsed.title} ${parsed.body}`),
                systemId: matched?.id ?? a.systemId,
                systemName: matched?.name ?? a.systemName,
                loaded: true,
              }
            : a,
        ),
      );
    } catch {
      // Keep subject fallback if message fetch fails.
    } finally {
      if (!options.silent && hooks.getBusyMap()[item.key] === "loading") {
        hooks.setItemBusy(item.key, null);
      }
    }
  }

  async function prewarm(): Promise<void> {
    if (prewarming || !hooks.getCaps().inboxMessage || !$metrix.inbox) return;
    prewarming = true;
    try {
      const candidates = hooks
        .getAlerts()
        .filter((a) => !a.loaded && !isDeleting(a.key))
        .slice(0, PREWARM_COUNT);
      for (const item of candidates) {
        if (hasBusyItem()) break;
        const latest = hooks.getAlerts().find((a) => a.key === item.key);
        if (!latest || latest.loaded) continue;
        await loadBody(latest, { silent: true });
      }
    } finally {
      prewarming = false;
    }
  }

  async function refresh(onlyIds?: string[]): Promise<void> {
    if (!$metrix.inbox) return;
    const gen = ++refreshGen;
    const caps = await hooks.syncInboxCaps();
    if (gen !== refreshGen) return;
    if (!caps.inboxBoxes || !caps.inboxList) {
      hooks.setBoundCount(0);
      hooks.setAlerts([]);
      return;
    }

    try {
      const boxes = await $metrix.inbox.boxes();
      if (gen !== refreshGen) return;
      hooks.setBoundCount(boxes.length);
      if (!boxes.length) {
        hooks.setAlerts([]);
        return;
      }

      const targets = onlyIds?.length ? boxes.filter((b) => onlyIds.includes(b.id)) : boxes;
      const fetched: { box: MetrixInboxSummary; items: MetrixInboxItem[] }[] = [];
      for (const box of targets) {
        const items = await $metrix.inbox.list(box.id, { limit: 20 });
        if (gen !== refreshGen) return;
        fetched.push({ box, items });
      }
      if (gen !== refreshGen) return;

      // Read latest map right before committing so concurrently loaded bodies are never overwritten.
      const current = hooks.getAlerts();
      const prevByKey = new Map(current.map((a) => [a.key, a]));
      const nextList: InboxAlert[] = onlyIds?.length
        ? current.filter((a) => !onlyIds.includes(a.inboxId) && !isDeleting(a.key))
        : [];
      let newestAlert: InboxAlert | null = null;
      const readKeys = hooks.getReadKeys();
      const systems = hooks.getSystems();

      for (const { box, items } of fetched) {
        for (const item of items) {
          const key = `${box.id}:${item.seq}`;
          if (isDeleting(key)) continue;
          const existing = prevByKey.get(key);
          const subject = item.subject?.trim() || "";
          const fallbackTitle = !subject;
          const rawTitle = subject || `${box.name || "Beszel"} #${item.seq}`;
          const title = existing?.loaded && !existing.fallbackTitle ? existing.title : rawTitle;
          const matched = matchSystemForText(`${title} ${existing?.body || ""}`, systems);
          const record: InboxAlert = existing
            ? {
                ...existing,
                title,
                fallbackTitle: existing.loaded ? existing.fallbackTitle : fallbackTitle,
                systemId: matched?.id ?? existing.systemId,
                systemName: matched?.name ?? existing.systemName,
              }
            : {
                key,
                inboxId: box.id,
                seq: item.seq,
                source: item.source,
                title,
                fallbackTitle,
                body: "",
                sender: item.sender || "",
                receivedAt: item.received_at,
                severity: classifyInboxSeverity(rawTitle),
                systemId: matched?.id,
                systemName: matched?.name,
                loaded: false,
              };
          if (!existing && lastRefreshAt > 0 && !readKeys.has(key)) {
            newestAlert = record;
          }
          nextList.push(record);
        }
      }

      nextList.sort((a, b) => b.receivedAt - a.receivedAt);
      hooks.setAlerts(nextList.slice(0, MAX_STORED_ALERTS));
      lastRefreshAt = Date.now();

      if (newestAlert) hooks.onNewAlert(newestAlert);
      void prewarm();
    } catch {
      // Inbox errors never disrupt primary monitoring.
    }
  }

  async function remove(item: InboxAlert): Promise<void> {
    if (!$metrix.inbox || isDeleting(item.key)) return;
    hooks.setItemBusy(item.key, "deleting");
    // Supersede any in-flight list refresh so stale responses cannot resurrect the deleted item.
    refreshGen++;
    const lang = hooks.getLang();
    try {
      const caps = await hooks.syncInboxCaps();
      if (!caps.inboxRemove) {
        toastHost(
          t(
            lang,
            "无删除权限，请在收件箱绑定中开启管理权限",
            "Enable manage access in inbox settings to delete",
          ),
        );
        return;
      }
      await withBusyRetry(() => $metrix.inbox!.remove(item.inboxId, item.seq), 350);
      hooks.setAlerts(hooks.getAlerts().filter((a) => a.key !== item.key));
      if (hooks.getExpandedKey() === item.key) hooks.setExpandedKey(null);
      hooks.deleteReadKey(item.key);
    } catch (err) {
      const msg = errorText(err);
      logHost("beszel inbox.remove failed:", msg);
      toastHost(t(lang, `删除失败：${msg || "请重试"}`, `Delete failed: ${msg || "try again"}`));
    } finally {
      if (hooks.getBusyMap()[item.key] === "deleting") {
        hooks.setItemBusy(item.key, null);
      }
    }
  }

  return { refresh, loadBody, remove, isStale, reset };
}
