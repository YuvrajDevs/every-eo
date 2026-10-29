import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { API_RATE_LIMIT } from "@/lib/api";
import { planForOrg } from "@/lib/plans";
import { revokeKey } from "@/app/actions";
import { Card, SectionTitle } from "@/components/ui";
import { ApiKeyForm } from "@/components/api-key-form";
import { CopyBlock } from "@/components/copy-block";

export default async function ApiPage() {
  const { org } = await requireUser();
  const enabled = Boolean(planForOrg(org).api);
  const keys = await db.apiKey.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" } });
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "https://your-app";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">API</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">Read your audits and AI visibility from your own dashboards and tools. Read-only, {API_RATE_LIMIT} requests per minute per key.</p>
      </div>
      {org.kind === "client" ? (
        <Card>
          <p className="text-sm">Use your agency&apos;s API key with the header <code>X-Workspace: {org.id}</code> to read this client.</p>
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle>Keys</SectionTitle>
            {!enabled && <p className="mb-3 rounded-xl bg-panel px-3 py-2 text-xs text-muted">API access is included in the Advanced and Agency plans.</p>}
            <ApiKeyForm enabled={enabled} />
            {keys.length > 0 && (
              <ul className="mt-4 space-y-2">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-panel px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">{k.name}</p>
                      <p className="text-[11px] text-muted">
                        <code>{k.prefix}…</code> · created {k.createdAt.toLocaleDateString()} · {k.lastUsedAt ? `last used ${k.lastUsedAt.toLocaleString()}` : "never used"}
                        {k.revokedAt ? ` · revoked ${k.revokedAt.toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    {!k.revokedAt && (
                      <form action={revokeKey.bind(null, k.id)}>
                        <button className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink">Revoke</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="space-y-4">
            <SectionTitle>Endpoints</SectionTitle>
            <CopyBlock label="List sites with latest health" code={`curl -H "Authorization: Bearer $KEY" ${base}/api/v1/sites`} />
            <CopyBlock label="Latest audit findings for a site" code={`curl -H "Authorization: Bearer $KEY" ${base}/api/v1/sites/SITE_ID/audit`} />
            <CopyBlock label="Latest AI visibility (rates with 95% ranges)" code={`curl -H "Authorization: Bearer $KEY" ${base}/api/v1/sites/SITE_ID/visibility`} />
            {org.kind === "agency" && <CopyBlock label="Agencies: list clients, then add X-Workspace to read one" code={`curl -H "Authorization: Bearer $KEY" ${base}/api/v1/clients\ncurl -H "Authorization: Bearer $KEY" -H "X-Workspace: CLIENT_ID" ${base}/api/v1/sites`} />}
            <p className="text-xs text-muted">Responses are JSON: {"{ data: … }"} on success, {"{ error: { code, message } }"} otherwise (401 bad key, 403 plan, 404 not found, 429 rate limited).</p>
          </Card>
        </>
      )}
    </div>
  );
}
