import { safeRequest } from "@/lib/safe-fetch";

// Client for the Visibility Connector plugin's REST API (integrations/wordpress/visibility-connector).

export type WpCredentials = { siteUrl: string; username: string; appPassword: string };
export type WpStatus = { plugin: string; wordpress: string; home: string; yoast: boolean; robots_file: boolean; blog_public: boolean; fixes: number };
export type WpFixRequest = { id: string; type: "jsonld" | "meta_description" | "robots_allow"; url?: string; sitewide?: boolean; payload: Record<string, unknown> };

export class WpError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
  }
}

export function normalizeSiteUrl(input: string) {
  const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/+$/, "");
}

async function call<T>(creds: WpCredentials, method: string, route: string, body?: unknown): Promise<T> {
  // ?rest_route= works whether or not pretty permalinks are enabled.
  const url = `${creds.siteUrl}/?rest_route=${encodeURIComponent(`/visibility/v1${route}`)}`;
  let res;
  try {
    res = await safeRequest(url, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${creds.username}:${creds.appPassword.replace(/\s+/g, "")}`).toString("base64")}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new WpError(`Couldn't reach ${creds.siteUrl}: ${err instanceof Error ? err.message : String(err)}`, null);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new WpError(`The site redirected to ${res.location ?? "another address"}. Use the site's final address (for example with https:// or www).`, res.status);
  }
  let json: { code?: string; message?: string } & Record<string, unknown>;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new WpError(`The site didn't return JSON (HTTP ${res.status}). Is this a WordPress site with the REST API enabled?`, res.status);
  }
  if (res.status === 401 || res.status === 403) {
    throw new WpError(
      json.code === "rest_forbidden" || json.code === "rest_cannot_view"
        ? "That user isn't an administrator, or the application password is wrong."
        : `WordPress rejected the login (${json.message ?? json.code ?? res.status}). Check the username and application password.`,
      res.status,
    );
  }
  if (res.status === 404 && json.code === "rest_no_route") {
    throw new WpError("The Visibility Connector plugin isn't installed or active on this site.", 404);
  }
  if (res.status >= 400) throw new WpError(json.message ?? `WordPress returned HTTP ${res.status}`, res.status);
  return json as T;
}

export const wp = {
  status: (c: WpCredentials) => call<WpStatus>(c, "GET", "/status"),
  apply: (c: WpCredentials, fix: WpFixRequest) => call<Record<string, unknown>>(c, "POST", "/fixes", fix),
  remove: (c: WpCredentials, id: string) => call<{ removed: string }>(c, "DELETE", `/fixes/${encodeURIComponent(id)}`),
  list: (c: WpCredentials) => call<{ id: string; type: string }[]>(c, "GET", "/fixes"),
};
