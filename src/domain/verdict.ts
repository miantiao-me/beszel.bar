import { peakMetric } from "../beszel/metrics.ts";
import type { ErrorKind, FleetSummary, SystemRecord } from "../beszel/types.ts";
import { t, type Lang } from "../host/bridge.ts";
import { clock, type Status } from "../ui/kit.ts";

function listNames(list: SystemRecord[], lang: Lang): string {
  const names = list
    .slice(0, 2)
    .map((system) => system.name)
    .join(t(lang, "、", ", "));
  return list.length > 2
    ? t(lang, `${names} 等 ${list.length} 台`, `${names} +${list.length - 2}`)
    : names;
}

export function formatErrorMessage(kind: ErrorKind, detail: string, lang: Lang): string {
  if (kind === "config") {
    return t(lang, "请在设置中填写地址与账号", "Set server URL and account in settings");
  }
  if (kind === "auth") {
    return t(lang, "登录失败，请检查邮箱与密码", "Sign-in failed, check email and password");
  }
  if (kind === "connect") {
    return t(
      lang,
      "无法连接 Beszel，请检查地址与网络",
      "Cannot reach Beszel, check URL and network",
    );
  }
  if (kind === "http") {
    return t(
      lang,
      `请求失败${detail ? `（${detail}）` : ""}`,
      `Request failed${detail ? ` (${detail})` : ""}`,
    );
  }
  return "";
}

export function buildFleetVerdict(input: {
  systems: SystemRecord[];
  summary: FleetSummary;
  threshold: number;
  errorKind: ErrorKind;
  errorMessage: string;
  isInitialLoading: boolean;
  stale: boolean;
  updatedAt: number;
  lang: Lang;
}): Status {
  const { systems, summary, errorKind, errorMessage, isInitialLoading, stale, updatedAt, lang } =
    input;
  if (!systems.length) {
    return errorKind
      ? { text: errorMessage, tone: "danger" }
      : {
          text: isInitialLoading
            ? t(lang, "加载中…", "Loading…")
            : t(lang, "暂无主机", "No servers yet"),
        };
  }

  const down = systems.filter((s) => s.status === "down");
  const limit = input.threshold || 90;
  const hot = systems.filter((s) => (peakMetric(s, lang)?.value ?? 0) >= limit);
  const pending = systems.filter((s) => s.status === "pending");

  let status: Status;
  if (down.length) {
    status = { text: `${listNames(down, lang)} ${t(lang, "离线", "down")}`, tone: "danger" };
  } else if (hot.length) {
    const peak = peakMetric(hot[0]!, lang)!;
    status = {
      text: `${hot[0]!.name} ${peak.label} ${Math.round(peak.value)}%${
        hot.length > 1 ? t(lang, ` 等 ${hot.length} 台`, ` +${hot.length - 1}`) : ""
      }`,
      tone: peak.value >= 90 ? "danger" : "warning",
    };
  } else if (pending.length) {
    status = {
      text: t(lang, `${pending.length} 台等待连接`, `${pending.length} pending`),
      tone: "warning",
    };
  } else {
    status = {
      text:
        summary.up === systems.length
          ? t(lang, `${summary.up} 台全部在线`, `All ${summary.up} up`)
          : t(lang, `${summary.up}/${systems.length} 在线`, `${summary.up}/${systems.length} up`),
      tone: "success",
    };
  }

  if (errorKind) return { text: `${status.text} · ${errorMessage}`, tone: "warning" };
  if (stale) {
    return {
      text: `${status.text} · ${t(lang, `数据停在 ${clock(updatedAt)}`, `as of ${clock(updatedAt)}`)}`,
      tone: "warning",
    };
  }
  return status;
}
