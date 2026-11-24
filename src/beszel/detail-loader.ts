import { t, type Lang } from "../host/bridge.ts";
import { classifyApiError, type BeszelClient } from "./client.ts";
import {
  PERIODS,
  type Container,
  type Detail,
  type ErrorKind,
  type PeriodKey,
  type SmartDevice,
  type StatsPoint,
  type SystemDetailsRecord,
  type SystemdService,
} from "./types.ts";

const DETAIL_CACHE_TTL_MS = 30_000;

export interface DetailLoaderHooks {
  getConnectionKey: () => string;
  getActiveTarget: () => { id: string | null; period: PeriodKey };
  hasSystem: (id: string) => boolean;
  getLang: () => Lang;
  getCurrentDetail: () => Detail | null;
  setDetail: (detail: Detail | null) => void;
  setLoading: (loading: boolean) => void;
  onError: (kind: Exclude<ErrorKind, "" | "config">, detail: string) => void;
}

/** Explicit detail fetch & cache controller with AbortController cancellation and stats-first streaming. */
export function createDetailLoader(client: BeszelClient, hooks: DetailLoaderHooks) {
  const cache = new Map<string, Detail>();
  let version = 0;
  let activeAbort: AbortController | null = null;

  const cacheKey = (id: string, period: PeriodKey) => `${hooks.getConnectionKey()}|${id}|${period}`;

  function cancel(): void {
    version++;
    activeAbort?.abort();
    activeAbort = null;
    hooks.setLoading(false);
  }

  function clear(): void {
    cancel();
    cache.clear();
  }

  async function load(
    id: string,
    period: PeriodKey,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    if (!hooks.hasSystem(id)) return;

    activeAbort?.abort();
    const controller = new AbortController();
    activeAbort = controller;
    const { signal } = controller;

    const run = ++version;
    const conn = hooks.getConnectionKey();
    const key = cacheKey(id, period);
    const cached = cache.get(key);
    const current = hooks.getCurrentDetail();
    if (cached && (current?.id !== id || current.period !== period)) {
      hooks.setDetail(cached);
    }
    if (!options.silent && !cached) {
      hooks.setLoading(true);
    }

    const isCurrent = () => {
      const target = hooks.getActiveTarget();
      return (
        !signal.aborted &&
        run === version &&
        id === target.id &&
        period === target.period &&
        conn === hooks.getConnectionKey()
      );
    };

    const cfg = PERIODS[period];
    const from = new Date(Date.now() - cfg.ms).toISOString().slice(0, 19).replace("T", " ");
    const baseFilter = `system="${id}" && created > "${from}"`;

    const publish = (patch: Partial<Detail>) => {
      if (!isCurrent()) return;
      const prev =
        hooks.getCurrentDetail()?.id === id && hooks.getCurrentDetail()?.period === period
          ? hooks.getCurrentDetail()!
          : (cached ?? {
              id,
              period,
              points: [],
              details: null,
              containers: [],
              services: [],
              smartDevices: [],
              error: "",
              loadedAt: 0,
            });
      const next: Detail = { ...prev, ...patch, id, period, loadedAt: Date.now() };
      cache.set(key, next);
      hooks.setDetail(next);
    };

    try {
      // Buffer fast metadata until stats land so Wave 1 paints in one frame, while still streaming stats immediately if metadata lags.
      let statsPublished = false;
      let pendingContainers: Container[] | undefined;
      let pendingDetails: SystemDetailsRecord | null | undefined;

      const statsTask = (async () => {
        const statsQuery = {
          perPage: cfg.perPage,
          skipTotal: 1,
          sort: "created",
          fields: "created,stats",
          filter: `${baseFilter} && type="${cfg.type}"`,
        };
        let items =
          (
            await client.get<{ items: StatsPoint[] }>(
              "/api/collections/system_stats/records",
              statsQuery,
              signal,
            )
          ).items ?? [];
        if (items.length === 0 && isCurrent()) {
          items =
            (
              await client.get<{ items: StatsPoint[] }>(
                "/api/collections/system_stats/records",
                { ...statsQuery, filter: baseFilter },
                signal,
              )
            ).items ?? [];
        }
        if (!isCurrent()) return;
        statsPublished = true;
        publish({
          points: items,
          error: "",
          ...(pendingContainers !== undefined ? { containers: pendingContainers } : {}),
          ...(pendingDetails !== undefined ? { details: pendingDetails } : {}),
        });
        pendingContainers = undefined;
        pendingDetails = undefined;
        hooks.setLoading(false);
      })();

      const containersTask = client
        .optionalGet<{ items: Container[] }>(
          "/api/collections/containers/records",
          { items: [] },
          {
            perPage: 50,
            skipTotal: 1,
            sort: "name",
            fields: "id,name,image,status,cpu,memory,net,health",
            filter: `system="${id}"`,
          },
          signal,
        )
        .then((res) => {
          const containers = res.items ?? [];
          if (statsPublished) publish({ containers });
          else pendingContainers = containers;
        });

      const detailsTask = client
        .optionalGet<SystemDetailsRecord | null>(
          `/api/collections/system_details/records/${encodeURIComponent(id)}`,
          null,
          undefined,
          signal,
        )
        .then((res) => {
          const details = res && typeof res === "object" ? res : null;
          if (statsPublished) publish({ details });
          else pendingDetails = details;
        });

      await Promise.all([statsTask, containersTask, detailsTask]);
      if (!isCurrent()) return;

      const [servicesRes, smartRes] = await Promise.all([
        client.optionalGet<{ items: SystemdService[] }>(
          "/api/collections/systemd_services/records",
          { items: [] },
          { perPage: 50, skipTotal: 1, sort: "name", filter: `system="${id}"` },
          signal,
        ),
        client.optionalGet<{ items: SmartDevice[] }>(
          "/api/collections/smart_devices/records",
          { items: [] },
          { perPage: 20, skipTotal: 1, sort: "name", filter: `system="${id}"` },
          signal,
        ),
      ]);

      const services = servicesRes.items ?? [];
      const smartDevices = smartRes.items ?? [];
      const cur = hooks.getCurrentDetail();
      if (
        services.length > 0 ||
        smartDevices.length > 0 ||
        (cur?.services.length ?? 0) > 0 ||
        (cur?.smartDevices.length ?? 0) > 0
      ) {
        publish({ services, smartDevices });
      }
    } catch (error) {
      if (!isCurrent()) return;
      const { kind, detail } = classifyApiError(error);
      hooks.onError(kind, detail);
      publish({ error: t(hooks.getLang(), "历史加载失败", "Failed to load history") });
    } finally {
      if (run === version) {
        hooks.setLoading(false);
        if (activeAbort === controller) activeAbort = null;
      }
    }
  }

  function open(id: string, period: PeriodKey): Promise<void> {
    const cached = cache.get(cacheKey(id, period));
    if (cached) {
      hooks.setDetail(cached);
      if (Date.now() - cached.loadedAt < DETAIL_CACHE_TTL_MS) {
        hooks.setLoading(false);
        return Promise.resolve();
      }
      return load(id, period, { silent: true });
    }
    hooks.setDetail(null);
    return load(id, period);
  }

  return { open, load, cancel, clear };
}
