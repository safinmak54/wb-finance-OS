import "server-only";
import type { ZodType } from "zod";
import { readServerEnv } from "@/lib/env";
import { AdminApiError } from "./errors";
import { getAccessToken } from "./token";

type Query = Record<string, string | number | undefined | null>;

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function adminApiFetch<T>(
  path: string,
  query: Query | undefined,
  schema: ZodType<T>,
): Promise<T> {
  const env = readServerEnv();
  const baseUrl = env.ADMIN_API_BASE_URL ?? "https://admin-api-dev.wrist-band.com";
  const url = buildUrl(baseUrl, path, query);

  let res = await callOnce(url, await getAccessToken());
  if (res.status === 401) {
    res = await callOnce(url, await getAccessToken({ force: true }));
  }

  const text = await res.text();

  if (res.status === 403) {
    throw new AdminApiError({
      kind: "forbidden",
      status: 403,
      message: `Forbidden on ${path}`,
      userMessage:
        "Admin API rejected this request — the API client is missing required scope.",
      bodySnippet: text.slice(0, 200),
    });
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new AdminApiError({
      kind: "rate_limited",
      status: 429,
      message: `Rate limited (Retry-After: ${retryAfter ?? "unset"})`,
      userMessage: `Admin API rate-limited the request${retryAfter ? ` (retry after ${retryAfter}s)` : ""}.`,
      bodySnippet: text.slice(0, 200),
    });
  }
  if (res.status === 401) {
    throw new AdminApiError({
      kind: "auth",
      status: 401,
      message: `Unauthorized on ${path} after token refresh`,
      userMessage: "Admin API rejected our credentials after a token refresh.",
      bodySnippet: text.slice(0, 200),
    });
  }
  if (!res.ok) {
    throw new AdminApiError({
      kind: "server",
      status: res.status,
      message: `Admin API ${res.status} on ${path}`,
      userMessage: `Admin API returned ${res.status}.`,
      bodySnippet: text.slice(0, 200),
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new AdminApiError({
      kind: "shape",
      status: res.status,
      message: `Non-JSON body from ${path}: ${(e as Error).message}`,
      userMessage: "Admin API returned a non-JSON response.",
      bodySnippet: text.slice(0, 200),
    });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AdminApiError({
      kind: "shape",
      status: res.status,
      message: `Schema mismatch on ${path}: ${parsed.error.message}`,
      userMessage: "Admin API returned data in an unexpected shape.",
      bodySnippet: text.slice(0, 200),
    });
  }
  return parsed.data;
}

async function callOnce(url: string, token: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (e) {
    throw new AdminApiError({
      kind: "network",
      message: `Fetch failed: ${(e as Error).message}`,
      userMessage: "Could not reach the Admin API. Check connectivity and try again.",
    });
  }
}
