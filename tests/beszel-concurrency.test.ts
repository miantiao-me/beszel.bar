import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import dashboard from "../src/index.ts";
import { click, find, host, nodes, requestURL, settled, type FetchInput } from "./helpers.ts";

host();

test("ignores history responses from the previous system", async () => {
  const env = { inputs: { lang: "zh", server: "https://fixture.invalid" } };
  Object.assign($metrix, { secret: () => "fixture" });
  const releases = new Map<string, (response: Response) => void>();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: FetchInput) => {
    const path = requestURL(url);
    if (path.includes("system_stats")) {
      const id = /system="([^"]+)"/.exec(new URL(path).searchParams.get("filter")!)![1]!;
      return new Promise<Response>((resolve) => {
        releases.set(id, resolve);
      });
    }
    return Response.json(
      path.includes("auth-with-password")
        ? { token: "fixture" }
        : path.includes("containers")
          ? { items: [] }
          : {
              items: ["a", "b"].map((id) => ({
                id,
                name: id,
                status: "up",
                info: { cpu: 20, mp: 30, dp: 10 },
              })),
            },
    );
  });
  await dashboard.scheduled(env);
  click(nodes(dashboard.render(env).panel).find((node) => node.props?.key === "system-a")!);
  await settled();
  click(find(dashboard.render(env).panel, "返回"));
  click(nodes(dashboard.render(env).panel).find((node) => node.props?.key === "system-b")!);
  await settled();
  releases.get("b")!(
    Response.json({
      items: [{ created: new Date().toISOString(), stats: { cpu: 77 } }],
    }),
  );
  await settled();
  releases.get("a")!(
    Response.json({
      items: [{ created: new Date().toISOString(), stats: { cpu: 11 } }],
    }),
  );
  await settled();
  const chart = nodes(dashboard.render(env).panel).find((node) => node.type === "Chart");
  assert.ok(chart, "当前主机的历史不能被迟到响应清空");
  const series = chart.props!.series as { points: { y: number }[] }[];
  assert.deepEqual(
    series.flatMap((item) => item.points.map((point) => point.y)),
    [77],
  );
});
