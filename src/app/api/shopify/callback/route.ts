import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { completeInstall, STATE_COOKIE } from "@/lib/shopify-install";

export async function GET(req: Request) {
  const { org } = await requireUser();
  const url = new URL(req.url);
  const jar = await cookies();
  const result = await completeInstall(url.searchParams, jar.get(STATE_COOKIE)?.value, org.id).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
  jar.delete(STATE_COOKIE);
  if ("error" in result) return new Response(result.error, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  return Response.redirect(new URL(`/dashboard/fixes/${result.domainId}?shopify=connected`, url), 303);
}
