import { destr } from "destr";
import type { SystemRecord } from "../beszel/types.ts";

export interface InboxAlert {
  key: string;
  inboxId: string;
  seq: number;
  source: string;
  title: string;
  fallbackTitle?: boolean;
  body: string;
  sender: string;
  receivedAt: number;
  severity: "critical" | "warning" | "info";
  systemId?: string;
  systemName?: string;
  loaded?: boolean;
}

export function matchSystemForText(
  text: string,
  systems: SystemRecord[],
): SystemRecord | undefined {
  const lower = text.toLowerCase();
  return systems.find(
    (s) =>
      (s.name && lower.includes(s.name.toLowerCase())) ||
      (s.host && lower.includes(s.host.toLowerCase())),
  );
}

export function classifyInboxSeverity(text: string): "critical" | "warning" | "info" {
  const lower = text.toLowerCase();
  if (/(down|offline|critical|fail|error|离线|故障|失败|告警)/.test(lower)) return "critical";
  if (/(resolved|recovered|online|up|恢复|正常)/.test(lower)) return "info";
  return "warning";
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim();
}

/** Extracts readable title & body from plain-text or JSON (e.g. Shoutrrr ?template=json) payloads. */
export function parseInboxContent(
  rawText: string,
  currentTitle: string,
  useFallbackTitle = false,
): { title: string; body: string } {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return { title: currentTitle, body: "" };

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = destr<unknown>(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const jsonTitle = firstNonEmptyString([record.title, record.subject]);
      const jsonBody = firstNonEmptyString([
        record.message,
        record.text,
        record.body,
        record.content,
      ]);
      if (jsonTitle || jsonBody) {
        const title = useFallbackTitle && jsonTitle ? jsonTitle : currentTitle;
        const body = jsonBody || (jsonTitle && jsonTitle !== title ? jsonTitle : "");
        return { title, body };
      }
    }
  }

  if (useFallbackTitle) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      const first = lines[0]!.length > 96 ? `${lines[0]!.slice(0, 95)}…` : lines[0]!;
      const rest = lines.slice(1).join("\n").trim();
      return { title: first, body: rest || trimmed };
    }
  }

  return { title: currentTitle, body: trimmed };
}
