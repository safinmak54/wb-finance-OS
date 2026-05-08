import "server-only";
import { z } from "zod";
import { readServerEnv } from "@/lib/env";
import { AdminApiError } from "./errors";

const TokenResponse = z.object({
  access_token: z.string().min(20),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

const SAFETY_MARGIN_MS = 60_000;

type Cached = { token: string; expiresAt: number };

let cached: Cached | null = null;
let inflight: Promise<string> | null = null;

export function _resetTokenCacheForTests() {
  cached = null;
  inflight = null;
}

export async function getAccessToken({ force }: { force?: boolean } = {}): Promise<string> {
  if (force) cached = null;

  if (cached && Date.now() < cached.expiresAt - SAFETY_MARGIN_MS) {
    return cached.token;
  }
  if (inflight) return inflight;

  inflight = mintToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function mintToken(): Promise<string> {
  const env = readServerEnv();
  const baseUrl = env.ADMIN_API_BASE_URL ?? "https://admin-api-dev.wrist-band.com";
  const clientId = env.ADMIN_API_CLIENT_ID;
  const clientSecret = env.ADMIN_API_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new AdminApiError({
      kind: "config",
      message: "Admin API credentials are not configured",
      userMessage:
        "Admin API credentials are missing. Set ADMIN_API_CLIENT_ID and ADMIN_API_CLIENT_SECRET in the environment.",
    });
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
  } catch (e) {
    throw new AdminApiError({
      kind: "network",
      message: `Token endpoint unreachable: ${(e as Error).message}`,
      userMessage: "Could not reach the Admin API. Check connectivity and try again.",
    });
  }

  const text = await res.text();

  if (res.status === 401) {
    throw new AdminApiError({
      kind: "auth",
      status: 401,
      message: "Admin API rejected client credentials",
      userMessage:
        "Admin API rejected our credentials. Verify ADMIN_API_CLIENT_ID and ADMIN_API_CLIENT_SECRET.",
      bodySnippet: text.slice(0, 200),
    });
  }
  if (!res.ok) {
    throw new AdminApiError({
      kind: "server",
      status: res.status,
      message: `Token endpoint returned ${res.status}`,
      userMessage: `Admin API token endpoint failed with status ${res.status}.`,
      bodySnippet: text.slice(0, 200),
    });
  }

  let parsed: z.infer<typeof TokenResponse>;
  try {
    parsed = TokenResponse.parse(JSON.parse(text));
  } catch (e) {
    throw new AdminApiError({
      kind: "shape",
      status: res.status,
      message: `Token response shape invalid: ${(e as Error).message}`,
      userMessage: "Admin API token response had an unexpected shape.",
      bodySnippet: text.slice(0, 200),
    });
  }

  cached = {
    token: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };
  return cached.token;
}
