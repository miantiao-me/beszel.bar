import { joinURL, parseURL, withQuery, type QueryObject } from "ufo";
import { errorText } from "../host/bridge.ts";
import type { ErrorKind } from "./types.ts";

const TOKEN_TTL_MS = 45 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  readonly kind: Exclude<ErrorKind, "" | "config">;
  readonly detail: string;

  constructor(kind: Exclude<ErrorKind, "" | "config">, detail: string) {
    super(detail || kind);
    this.kind = kind;
    this.detail = detail;
  }
}

export function classifyApiError(error: unknown): {
  kind: Exclude<ErrorKind, "" | "config">;
  detail: string;
} {
  if (error instanceof ApiError) return { kind: error.kind, detail: error.detail };
  return { kind: "connect", detail: errorText(error) };
}

export function originOf(value: string): string {
  const text = value.trim();
  // ufo's withHttp rewrites https and mistakes "host:port" for a scheme.
  const url = parseURL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
  return `${url.protocol}//${url.host}`;
}

/** Single-pass timed JSON fetch that cancels unread/error bodies immediately to free host fetch slots. */
async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ status: number; ok: boolean; data?: T }> {
  init.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | undefined;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel?.().catch(() => {});
      return { status: response.status, ok: false };
    }
    const data = (await response.json()) as T;
    return { status: response.status, ok: true, data };
  } catch (error) {
    void response?.body?.cancel?.().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

type AuthState =
  | { status: "idle" }
  | { status: "authenticating"; promise: Promise<string>; gen: number }
  | { status: "ready"; token: string; expiresAt: number };

export interface BeszelCredentials {
  baseUrl: string;
  email: string;
  password: string;
}

/** PocketBase HTTP client with an explicit single-flight auth session state machine. */
export function createBeszelClient(getCredentials: () => BeszelCredentials) {
  let auth: AuthState = { status: "idle" };
  let sessionGen = 0;

  function reset(): void {
    sessionGen++;
    auth = { status: "idle" };
  }

  function ensureToken(signal?: AbortSignal): Promise<string> {
    if (auth.status === "ready" && Date.now() < auth.expiresAt) {
      return Promise.resolve(auth.token);
    }
    if (auth.status === "authenticating") {
      return auth.promise;
    }

    const gen = sessionGen;
    const { baseUrl, email, password } = getCredentials();
    const promise = (async () => {
      const res = await fetchJson<{ token?: string }>(
        joinURL(baseUrl, "/api/collections/users/auth-with-password"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity: email, password }),
          signal,
        },
      );
      if (res.status === 400 || res.status === 401) throw new ApiError("auth", "");
      if (!res.ok) throw new ApiError("http", `HTTP ${res.status}`);
      if (!res.data?.token) throw new ApiError("auth", "");
      if (gen === sessionGen) {
        auth = { status: "ready", token: res.data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
      }
      return res.data.token;
    })().catch((err) => {
      if (gen === sessionGen && auth.status === "authenticating" && auth.gen === gen) {
        auth = { status: "idle" };
      }
      throw err;
    });

    auth = { status: "authenticating", promise, gen };
    return promise;
  }

  async function get<T>(path: string, query?: QueryObject, signal?: AbortSignal): Promise<T> {
    const { baseUrl } = getCredentials();
    const url = query ? withQuery(joinURL(baseUrl, path), query) : joinURL(baseUrl, path);

    const send = (token: string) =>
      fetchJson<T>(url, { headers: { Authorization: `Bearer ${token}` }, signal });

    let token = await ensureToken(signal);
    let res = await send(token);
    if (res.status === 401) {
      if (auth.status === "ready" && auth.token === token) auth = { status: "idle" };
      token = await ensureToken(signal);
      res = await send(token);
    }
    if (!res.ok) throw new ApiError("http", `HTTP ${res.status}`);
    return res.data as T;
  }

  function optionalGet<T>(
    path: string,
    fallback: T,
    query?: QueryObject,
    signal?: AbortSignal,
  ): Promise<T> {
    return get<T>(path, query, signal).catch(() => fallback);
  }

  return { get, optionalGet, reset };
}

export type BeszelClient = ReturnType<typeof createBeszelClient>;
