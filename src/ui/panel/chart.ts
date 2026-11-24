import { scaleRateUnit, timestamp } from "../../beszel/format.ts";
import { statsBandwidthBytes, statsDiskIoBytes } from "../../beszel/metrics.ts";
import {
  PERIODS,
  type Detail,
  type MetricTab,
  type PeriodKey,
  type StatsPoint,
} from "../../beszel/types.ts";
import { t, type Lang } from "../../host/bridge.ts";
import { h, splitSeries, T, type VNode } from "../kit.ts";
import { cardClass, PAL, pill, statusDot } from "../theme.ts";
import type { PanelActions, PanelState } from "./types.ts";

interface ChartLine {
  name: string;
  color: string;
  runs: { x: number; y: number; valueLabel?: string }[][];
}

function buildRuns(
  points: StatsPoint[],
  pick: (s: StatsPoint["stats"]) => number | null,
  labelOf: (v: number) => string,
) {
  return splitSeries(
    points
      .map((point) => ({ x: timestamp(point.created), y: pick(point.stats) }))
      .filter((point) => Number.isFinite(point.x)),
  ).map((run) => run.map((pt) => ({ ...pt, valueLabel: labelOf(pt.y) })));
}

function buildDualRateChart(
  points: StatsPoint[],
  pickPair: (s: StatsPoint["stats"]) => [number | null, number | null],
  specs: [
    { legend: string; series: (unit: string) => string; color: string },
    { legend: string; series: (unit: string) => string; color: string },
  ],
): { unitBadge: string; legend: { name: string; color: string }[]; lines: ChartLine[] } {
  let maxBytes = 0;
  for (const p of points) {
    const [a, b] = pickPair(p.stats);
    if (a !== null) maxBytes = Math.max(maxBytes, a);
    if (b !== null) maxBytes = Math.max(maxBytes, b);
  }
  const { unit, divisor } = scaleRateUnit(maxBytes);
  const scale = (v: number | null) => (v !== null ? Number((v / divisor).toFixed(2)) : null);
  const fmt = (v: number) => `${v.toFixed(2)} ${unit}`;

  return {
    unitBadge: unit,
    legend: specs.map((s) => ({ name: s.legend, color: s.color })),
    lines: specs.map((s, idx) => ({
      name: s.series(unit),
      color: s.color,
      runs: buildRuns(points, (stats) => scale(pickPair(stats)[idx]!), fmt),
    })),
  };
}

function buildChartConfig(
  points: StatsPoint[],
  metric: MetricTab,
  lang: Lang,
): { unitBadge: string; legend: { name: string; color: string }[]; lines: ChartLine[] } {
  if (metric === "CPU" || metric === "MEM") {
    const isCpu = metric === "CPU";
    return {
      unitBadge: "",
      legend: [],
      lines: [
        {
          name: isCpu ? "CPU %" : t(lang, "内存 %", "Memory %"),
          color: isCpu ? PAL.blue : PAL.emerald,
          runs: buildRuns(
            points,
            (s) => {
              const v = isCpu ? s.cpu : s.mp;
              return typeof v === "number" && Number.isFinite(v) ? v : null;
            },
            (v) => `${v.toFixed(1)}%`,
          ),
        },
      ],
    };
  }
  if (metric === "NET") {
    return buildDualRateChart(
      points,
      (s) => {
        const bw = statsBandwidthBytes(s);
        return [bw.recv, bw.sent];
      },
      [
        {
          legend: t(lang, "下行", "In"),
          series: (u) => t(lang, `下行 (${u})`, `In (${u})`),
          color: PAL.emerald,
        },
        {
          legend: t(lang, "上行", "Out"),
          series: (u) => t(lang, `上行 (${u})`, `Out (${u})`),
          color: PAL.rose,
        },
      ],
    );
  }
  return buildDualRateChart(
    points,
    (s) => {
      const dio = statsDiskIoBytes(s);
      return [dio.read, dio.write];
    },
    [
      {
        legend: t(lang, "读", "Read"),
        series: (u) => t(lang, `读取 (${u})`, `Read (${u})`),
        color: PAL.blue,
      },
      {
        legend: t(lang, "写", "Write"),
        series: (u) => t(lang, `写入 (${u})`, `Write (${u})`),
        color: PAL.orange,
      },
    ],
  );
}

export function chartPanel(detail: Detail | null, state: PanelState, actions: PanelActions): VNode {
  const { lang, historyMetric, historyPeriod } = state;
  const points = detail?.points ?? [];
  const periodCfg = PERIODS[historyPeriod];
  const now = Date.now();
  const hasDiskIo = points.some((p) => {
    const dio = statsDiskIoBytes(p.stats);
    return dio.read !== null || dio.write !== null;
  });

  const metricItems: { label: string; value: MetricTab }[] = [
    { label: "CPU", value: "CPU" },
    { label: t(lang, "内存", "MEM"), value: "MEM" },
    { label: t(lang, "网络", "NET"), value: "NET" },
    ...(hasDiskIo || historyMetric === "DISK"
      ? [{ label: t(lang, "磁盘", "DISK"), value: "DISK" as MetricTab }]
      : []),
  ];

  const { unitBadge, legend, lines } = buildChartConfig(points, historyMetric, lang);
  const allRuns = lines.flatMap((line) => line.runs);
  const hasPoints = allRuns.some((run) => run.length > 0);
  const isPercent = historyMetric === "CPU" || historyMetric === "MEM";

  return h(
    "Column",
    { tw: `${cardClass("p-3 gap-2")} w-full` },
    h(
      "Row",
      { tw: "items-center gap-2 w-full" },
      T(t(lang, "历史趋势", "History"), { tw: "text-[12px] font-semibold shrink-0" }),
      unitBadge ? pill(unitBadge, PAL.muted) : null,
      h("Spacer"),
      h("Segmented", {
        key: "period-picker",
        value: historyPeriod,
        items: (["1h", "12h", "24h", "7d"] as PeriodKey[]).map((value) => ({
          label: value,
          value,
        })),
        onChange: (value: string) => actions.onSetPeriod(value as PeriodKey),
      }),
    ),
    h(
      "Row",
      { tw: "items-center gap-2 w-full" },
      h("Segmented", {
        key: "metric-picker",
        value: historyMetric,
        items: metricItems,
        onChange: (value: string) => actions.onSetMetric(value as MetricTab),
      }),
      h("Spacer"),
      ...legend.map((item) =>
        h(
          "Row",
          { tw: "items-center gap-1 shrink-0" },
          statusDot(item.color, 6),
          T(item.name, { tw: "text-[10.5px] text-textMuted" }),
        ),
      ),
    ),
    hasPoints
      ? h("Chart", {
          type: isPercent ? "area" : "line",
          xKind: "time",
          height: 98,
          curve: "monotone",
          strokeWidth: 1.75,
          grid: true,
          gridStyle: "dashed",
          legend: false,
          hover: true,
          appear: false,
          dots: allRuns.some((run) => run.length === 1),
          xDomain: [now - periodCfg.ms, now],
          ...(isPercent ? { yDomain: [0, 100] } : {}),
          yTicks: 3,
          xTicks: 4,
          series: lines.flatMap((line) =>
            line.runs.map((pts) => ({
              name: line.name,
              color: line.color,
              ...(isPercent ? { fill: 0.2 } : {}),
              points: pts,
            })),
          ),
          tw: "w-full",
        })
      : h(
          "Column",
          { tw: "h-[98px] items-center justify-center" },
          T(
            detail?.error ||
              (state.detailLoading
                ? t(lang, "加载中…", "Loading…")
                : t(lang, "暂无数据", "No data")),
            { tw: `text-[11px] ${detail?.error ? "text-[#ef4444]" : "text-textMuted"}` },
          ),
        ),
  );
}
