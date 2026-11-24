import { peakMetric } from "../beszel/metrics.ts";
import type { SystemRecord } from "../beszel/types.ts";
import { expandHostNotch, sendHostNotification, t, type Lang } from "../host/bridge.ts";
import type { InboxAlert } from "../inbox/parser.ts";

const NOTIFY_WINDOW_MS = 30 * 60_000;
const NOTCH_ACTIVITY_TTL_MS = 3 * 60_000;

export interface AlertTransition {
  key: string;
  tag: string;
  title: string;
  body: string;
  activityKey: string;
}

/** Pure state-transition detector for newly offline or over-threshold servers. */
export function detectAlertTransitions(
  systems: SystemRecord[],
  previousDown: ReadonlySet<string>,
  previousHot: ReadonlySet<string>,
  threshold: number,
  lang: Lang,
): {
  nextDown: Set<string>;
  nextHot: Set<string>;
  transitions: AlertTransition[];
} {
  const nextDown = new Set<string>();
  const nextHot = new Set<string>();
  const transitions: AlertTransition[] = [];

  for (const system of systems) {
    if (system.status === "down") {
      nextDown.add(system.id);
      if (!previousDown.has(system.id)) {
        transitions.push({
          key: system.id,
          tag: `beszel-sys-${system.id}`,
          title: t(lang, "主机离线", "Server down"),
          body: system.name,
          activityKey: `down-${system.id}`,
        });
      }
      continue;
    }

    const peak = threshold > 0 ? peakMetric(system, lang) : null;
    if (peak && peak.value >= threshold) {
      const key = `${system.id}:${peak.label}`;
      nextHot.add(key);
      if (!previousHot.has(key)) {
        transitions.push({
          key,
          tag: `beszel-sys-${key}`,
          title: `${system.name} ${peak.label} ${Math.round(peak.value)}%`,
          body: t(lang, `达到 ${threshold}% 告警阈值`, `Reached ${threshold}% alert threshold`),
          activityKey: `hot-${system.id}`,
        });
      }
    }
  }

  return { nextDown, nextHot, transitions };
}

export interface AlertMonitorHooks {
  canNotchActivity: () => boolean;
  canNotchSetState: () => boolean;
  setNotchActivity: (activity: { id: string; expiresAt: number } | null) => void;
  onNotificationClick: (tag: string) => void;
}

/** Cooldown notification & notch live-activity state machine for fleet + inbox alerts. */
export function createAlertMonitor(hooks: AlertMonitorHooks) {
  let previousDown = new Set<string>();
  let previousHot = new Set<string>();
  const notifiedAt = new Map<string, number>();
  let activitySeq = 0;

  function reset(): void {
    previousDown = new Set();
    previousHot = new Set();
    hooks.setNotchActivity(null);
  }

  function triggerActivity(reasonKey: string): void {
    if (!hooks.canNotchActivity()) return;
    hooks.setNotchActivity({
      id: `beszel-${++activitySeq}-${reasonKey}`,
      expiresAt: Date.now() + NOTCH_ACTIVITY_TTL_MS,
    });
    if (hooks.canNotchSetState()) expandHostNotch(6000);
  }

  function notifyWithCooldown(key: string, title: string, body: string, tag: string): void {
    if (Date.now() - (notifiedAt.get(key) ?? 0) < NOTIFY_WINDOW_MS) return;
    if (sendHostNotification(title, body, tag, () => hooks.onNotificationClick(tag))) {
      notifiedAt.set(key, Date.now());
    }
  }

  function processFleet(
    systems: SystemRecord[],
    threshold: number,
    notifyEnabled: boolean,
    lang: Lang,
  ): void {
    const { nextDown, nextHot, transitions } = detectAlertTransitions(
      systems,
      previousDown,
      previousHot,
      threshold,
      lang,
    );
    previousDown = nextDown;
    previousHot = nextHot;

    if (transitions.length === 0) return;
    triggerActivity(transitions[0]!.activityKey);
    if (!notifyEnabled) return;
    for (const item of transitions) {
      notifyWithCooldown(item.key, item.title, item.body, item.tag);
    }
  }

  function processInboxAlert(alert: InboxAlert, notifyEnabled: boolean, lang: Lang): void {
    triggerActivity(`inbox-${alert.key}`);
    if (!notifyEnabled) return;
    notifyWithCooldown(
      `inbox-${alert.key}`,
      t(lang, "Beszel 告警消息", "Beszel Alert"),
      alert.title,
      `beszel-inbox-${alert.key}`,
    );
  }

  return { processFleet, processInboxAlert, reset };
}
