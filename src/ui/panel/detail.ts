import {
  formatGb,
  formatMemoryMb,
  formatRate,
  statusTone,
  statusWord,
  uptime,
} from "../../beszel/format.ts";
import {
  containerHealth,
  isServiceFailed,
  isSmartBad,
  sortContainers,
  systemBandwidthBytes,
  systemLoad,
} from "../../beszel/metrics.ts";
import type {
  Container,
  Detail,
  SmartDevice,
  SystemdService,
  SystemRecord,
} from "../../beszel/types.ts";
import { t, type Lang } from "../../host/bridge.ts";
import { h, T, type VNode } from "../kit.ts";
import {
  cardClass,
  ghostIconButton,
  hairline,
  metricHex,
  metricTextClass,
  PAL,
  pill,
  sectionHeading,
  slimBar,
  statusDot,
  toneColorHex,
} from "../theme.ts";
import { chartPanel } from "./chart.ts";
import type { PanelActions, PanelState } from "./types.ts";

function detailSummaryCard(system: SystemRecord, detail: Detail | null, lang: Lang): VNode {
  const info = system.info;
  const hw = detail?.details;
  const latest = detail?.points.at(-1)?.stats;
  const live = system.status === "up" && Boolean(info);
  const load = systemLoad(info);
  const bw = systemBandwidthBytes(info);

  const memSub =
    latest?.mu !== undefined && latest?.m !== undefined
      ? `${formatGb(latest.mu)} / ${formatGb(latest.m)}`
      : hw?.memory
        ? formatGb(hw.memory / 1024 ** 3)
        : "";
  const diskSub =
    latest?.du !== undefined && latest?.d !== undefined
      ? `${formatGb(latest.du)} / ${formatGb(latest.d)}`
      : "";
  const coreText = hw?.cores
    ? hw.threads && hw.threads !== hw.cores
      ? `${hw.cores}C / ${hw.threads}T`
      : `${hw.cores}`
    : info?.c
      ? String(info.c)
      : "";

  const facts: [string, string, boolean?][] = [];
  if (info?.u && info.u > 0) facts.push([t(lang, "运行", "Uptime"), uptime(info.u, lang)]);
  if (load) facts.push([t(lang, "负载", "Load"), load.map((v) => v.toFixed(2)).join(" / ")]);
  if (coreText) facts.push([t(lang, "核心", "Cores"), coreText]);
  if (bw !== null) facts.push([t(lang, "网络", "Network"), formatRate(bw)]);
  if (hw?.kernel || info?.k) facts.push([t(lang, "内核", "Kernel"), hw?.kernel || info?.k || ""]);
  if (hw?.os_name) facts.push([t(lang, "系统", "OS"), hw.os_name]);
  if (hw?.cpu || info?.m) facts.push([t(lang, "处理器", "CPU"), hw?.cpu || info?.m || ""]);
  if (info?.dt !== undefined && Number.isFinite(info.dt)) {
    facts.push([t(lang, "温度", "Temp"), `${Math.round(info.dt)}°C`, info.dt >= 85]);
  }
  if (info?.g !== undefined && Number.isFinite(info.g)) {
    facts.push(["GPU", `${Math.round(info.g)}%`, info.g >= 90]);
  }
  if (info?.sv) {
    facts.push([
      t(lang, "服务", "Services"),
      t(lang, `${info.sv[0]} 个，失败 ${info.sv[1]}`, `${info.sv[0]} total, ${info.sv[1]} failed`),
      info.sv[1] > 0,
    ]);
  }

  const metricBox = (title: string, value: number | undefined, sub: string) =>
    h(
      "Column",
      { tw: "flex-1 min-w-0 gap-1" },
      T(live && value !== undefined ? `${Math.round(value)}%` : "—", {
        tw: `text-[20px] font-bold tabular-nums leading-none ${
          live && value !== undefined ? metricTextClass(value) : "text-textMuted"
        }`,
      }),
      T(title, { tw: "text-[10.5px] font-medium text-textMuted" }),
      live && value !== undefined ? slimBar(value, metricHex(value, PAL.green), 3.5) : null,
      sub ? T(sub, { tw: "text-[10px] text-textMuted tabular-nums truncate" }) : null,
    );

  return h(
    "Column",
    { tw: `${cardClass("p-3 gap-2.5")} w-full` },
    h(
      "Row",
      { tw: "gap-3 w-full" },
      metricBox("CPU", info?.cpu, ""),
      metricBox(t(lang, "内存", "Memory"), info?.mp, memSub),
      metricBox(t(lang, "磁盘", "Disk"), info?.dp, diskSub),
    ),
    facts.length ? hairline() : null,
    facts.length
      ? h(
          "Grid",
          { columns: 3, gap: 6, tw: "w-full" },
          ...facts.map(([label, value, danger]) =>
            h(
              "Column",
              { tw: "min-w-0 gap-0.5" },
              T(label, { tw: "text-[9.5px] text-textMuted" }),
              T(value, {
                tw: `text-[11px] font-medium tabular-nums truncate ${
                  danger ? "text-[#ef4444]" : "text-text"
                }`,
              }),
            ),
          ),
        )
      : null,
  );
}

function containersSection(containers: Container[], lang: Lang): VNode | null {
  if (!containers.length) return null;
  const sorted = sortContainers(containers, lang);
  return h(
    "Column",
    { tw: "gap-1.5 w-full" },
    sectionHeading(t(lang, `容器 · ${sorted.length}`, `Containers · ${sorted.length}`)),
    h(
      "Column",
      { tw: `${cardClass("overflow-hidden")} w-full` },
      ...sorted.flatMap((container, idx) => {
        const health = containerHealth(container, lang);
        return [
          idx > 0 ? hairline() : null,
          h(
            "Row",
            { key: `container-${container.id}`, tw: "px-3 py-1.5 items-center gap-2 w-full" },
            statusDot(toneColorHex(health.tone), 6),
            h(
              "Column",
              { tw: "flex-1 min-w-0" },
              T(container.name, { tw: "text-[11.5px] font-medium truncate" }),
              T(container.status || health.label, {
                tw: `text-[10px] truncate ${
                  health.bad ? `text-[${toneColorHex(health.tone)}]` : "text-textMuted"
                }`,
              }),
            ),
            container.memory !== undefined
              ? T(formatMemoryMb(container.memory), {
                  tw: "text-[10.5px] text-textMuted tabular-nums shrink-0",
                })
              : null,
            T(`${Math.round(container.cpu ?? 0)}%`, {
              tw: `w-[34px] text-right text-[11px] font-medium tabular-nums shrink-0 ${metricTextClass(container.cpu ?? 0)}`,
            }),
          ),
        ];
      }),
    ),
  );
}

function servicesSection(services: SystemdService[], lang: Lang): VNode | null {
  if (!services.length) return null;
  const failed = services.filter(isServiceFailed);
  const shown = failed.length
    ? [...failed, ...services.filter((s) => !isServiceFailed(s)).slice(0, 6)]
    : services.slice(0, 8);
  return h(
    "Column",
    { tw: "gap-1.5 w-full" },
    sectionHeading(
      failed.length
        ? t(lang, `Systemd 服务 · ${failed.length} 失败`, `Systemd · ${failed.length} failed`)
        : t(lang, `Systemd 服务 · ${services.length}`, `Systemd · ${services.length}`),
    ),
    h(
      "Column",
      { tw: `${cardClass("overflow-hidden")} w-full` },
      ...shown.flatMap((svc, idx) => {
        const bad = isServiceFailed(svc);
        return [
          idx > 0 ? hairline() : null,
          h(
            "Row",
            { key: `svc-${svc.id || svc.name}`, tw: "px-3 py-1.5 items-center gap-2 w-full" },
            statusDot(bad ? PAL.red : PAL.green, 6),
            T(svc.name, { tw: "text-[11.5px] font-medium flex-1 min-w-0 truncate" }),
            T(String(svc.sub ?? svc.state ?? "—"), {
              tw: `text-[10.5px] shrink-0 ${bad ? "text-[#ef4444] font-semibold" : "text-textMuted"}`,
            }),
          ),
        ];
      }),
    ),
  );
}

function smartSection(devices: SmartDevice[], lang: Lang): VNode | null {
  if (!devices.length) return null;
  return h(
    "Column",
    { tw: "gap-1.5 w-full" },
    sectionHeading(
      t(lang, `S.M.A.R.T. 硬盘 · ${devices.length}`, `S.M.A.R.T. · ${devices.length}`),
    ),
    h(
      "Column",
      { tw: `${cardClass("overflow-hidden")} w-full` },
      ...devices.flatMap((dev, idx) => {
        const bad = isSmartBad(dev);
        const passed = (dev.state || "").toUpperCase() === "PASSED";
        return [
          idx > 0 ? hairline() : null,
          h(
            "Row",
            { key: `smart-${dev.id || dev.name}`, tw: "px-3 py-1.5 items-center gap-2 w-full" },
            statusDot(bad ? PAL.red : passed ? PAL.green : PAL.muted, 6),
            h(
              "Column",
              { tw: "flex-1 min-w-0" },
              T(dev.model || dev.name, { tw: "text-[11.5px] font-medium truncate" }),
              dev.model ? T(dev.name, { tw: "text-[10px] text-textMuted truncate" }) : null,
            ),
            dev.temp !== undefined && Number.isFinite(dev.temp)
              ? T(`${Math.round(dev.temp)}°C`, {
                  tw: `text-[10.5px] tabular-nums shrink-0 ${
                    dev.temp >= 55 ? "text-[#eab308]" : "text-textMuted"
                  }`,
                })
              : null,
            pill(dev.state || "UNKNOWN", bad ? PAL.red : passed ? PAL.green : PAL.muted),
          ),
        ];
      }),
    ),
  );
}

/** Returns [header, scroll] directly so narrow full-screen detail avoids an extra wrapper Column. */
export function detailContent(
  system: SystemRecord,
  state: PanelState,
  actions: PanelActions,
  showBack: boolean,
): VNode[] {
  const { lang } = state;
  const detail = state.detail?.id === system.id ? state.detail : null;
  const tone = statusTone(system.status);
  const copied = state.copiedKey === `sys:${system.id}`;

  return [
    h(
      "Row",
      { tw: "items-center gap-2 w-full px-3.5 pt-3 pb-2 shrink-0" },
      showBack
        ? ghostIconButton("back", actions.onCloseDetail, {
            key: "detail-back",
            tooltip: t(lang, "返回", "Back"),
          })
        : null,
      statusDot(toneColorHex(tone), 8),
      h(
        "Column",
        { tw: "flex-1 min-w-0 gap-0.5" },
        T(system.name, { tw: "text-[13.5px] font-semibold truncate" }),
        T(
          [
            system.host || detail?.details?.hostname || system.info?.h,
            statusWord(system.status, lang),
          ]
            .filter(Boolean)
            .join(" · "),
          {
            tw: `text-[11px] truncate ${
              system.status === "up" ? "text-textMuted" : `text-[${toneColorHex(tone)}]`
            }`,
          },
        ),
      ),
      ghostIconButton(copied ? "check" : "clipboard", () => actions.onCopySummary(system), {
        key: "detail-copy",
        tooltip: copied ? t(lang, "已复制", "Copied") : t(lang, "复制摘要", "Copy summary"),
        color: copied ? "text" : "textMuted",
      }),
      state.serverUrl
        ? ghostIconButton("external", () => actions.onOpenBeszel(system.id), {
            key: "detail-open",
            tooltip: t(lang, "打开 Beszel", "Open in Beszel"),
          })
        : null,
    ),
    h(
      "Scroll",
      { tw: "flex-1 min-h-0" },
      h(
        "Column",
        { tw: "px-3.5 pb-3.5 gap-2.5" },
        detailSummaryCard(system, detail, lang),
        chartPanel(detail, state, actions),
        containersSection(detail?.containers ?? [], lang),
        servicesSection(detail?.services ?? [], lang),
        smartSection(detail?.smartDevices ?? [], lang),
      ),
    ),
  ];
}
