import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadFixContext } from "@/lib/fix-context";
import { PLATFORM_LABELS, guidanceFor, type PlatformId } from "@/lib/platforms";
import { scriptTag } from "@/lib/entity";
import { shopifySupports } from "@/lib/fix-engine";
import { shopifyConfigured } from "@/lib/shopify";
import { disconnectWp, recheckFix, rollbackAppliedFix } from "@/app/actions";
import { Card, EvidenceBadge, SectionTitle } from "@/components/ui";
import { CopyBlock } from "@/components/copy-block";
import { ApplyFixForm, ConnectWpForm } from "@/components/fix-forms";

const STATUS: Record<string, { label: string; tone: string }> = {
  verified: { label: "Live on site", tone: "bg-mint text-ok" },
  applied: { label: "Applied", tone: "bg-sky" },
  not_visible: { label: "Applied, not visible yet", tone: "bg-peach" },
  failed: { label: "Failed", tone: "bg-rose text-high" },
  rolled_back: { label: "Rolled back", tone: "bg-panel text-muted" },
};

const SHOPIFY_NOTICE: Record<string, string> = {
  connected: "Shopify store connected.",
  not_configured: "The Shopify app isn't configured on this server yet (SHOPIFY_API_KEY / SHOPIFY_API_SECRET).",
  bad_shop: "Enter your store's myshopify.com address, e.g. your-store.myshopify.com.",
};

export default async function FixesPage({ params, searchParams }: { params: Promise<{ domainId: string }>; searchParams: Promise<{ shopify?: string }> }) {
  const [{ domainId }, { shopify: shopifyNotice }] = await Promise.all([params, searchParams]);
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id }, include: { wordpress: true, shopify: true, fixes: { orderBy: { createdAt: "desc" } } } });
  if (!domain) notFound();
  const { crawl, proposals, blocked } = await loadFixContext(domain);
  const platform = (crawl?.platform ?? "unknown") as PlatformId;
  const isShopify = platform === "shopify" || Boolean(domain.shopify);
  const autoFix = isShopify || platform === "wordpress" || (platform === "unknown" && Boolean(domain.wordpress));
  // Detection can miss WordPress (e.g. hidden generator tags), so unknown sites can still connect the plugin.
  const showWpCard = !isShopify && (platform === "wordpress" || platform === "unknown");
  const connected = isShopify ? Boolean(domain.shopify) : Boolean(domain.wordpress);
  const canApply = (p: (typeof proposals)[number]) => autoFix && (!isShopify || shopifySupports(p));
  const active = new Map(domain.fixes.filter((f) => f.status !== "rolled_back").map((f) => [f.key, f]));
  const open = proposals.filter((p) => !active.has(p.key) || active.get(p.key)!.status === "failed");

  return (
    <div className="space-y-6">
      <div>
        <Link href={crawl ? `/dashboard/crawls/${crawl.id}` : "/dashboard/sites"} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> Audit
        </Link>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Fixes for {domain.hostname}</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          Changes we can make for you from your latest audit. Each one is checked on your live site afterwards and can be rolled back. Copy and titles that need judgment stay with you.
        </p>
      </div>

      {!crawl && (
        <Card>
          <p>Run an audit first; fixes are built from its findings.</p>
        </Card>
      )}

      {shopifyNotice && SHOPIFY_NOTICE[shopifyNotice] && (
        <Card className={shopifyNotice === "connected" ? "bg-mint" : "bg-peach"}>
          <p className="text-sm">{SHOPIFY_NOTICE[shopifyNotice]}</p>
        </Card>
      )}

      {crawl && isShopify && (
        <Card>
          <SectionTitle>Shopify connection</SectionTitle>
          {domain.shopify ? (
            <div className="space-y-2 text-sm">
              <p>
                Connected to <strong>{domain.shopify.shop}</strong>.
              </p>
              <p className="text-xs text-muted">
                Turn on the &quot;Visibility structured data&quot; app embed once: Online Store → Themes → Customize → App embeds. Fixes appear on your storefront after that.
              </p>
            </div>
          ) : (
            <form action="/api/shopify/install" method="get" className="space-y-3">
              <input type="hidden" name="domainId" value={domain.id} />
              <label className="block space-y-1">
                <span className="text-xs font-semibold">Store address</span>
                <input name="shop" placeholder="your-store.myshopify.com" required className="w-full rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-ink" />
              </label>
              <button disabled={!shopifyConfigured()} className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-40">
                Install the Shopify app
              </button>
              {!shopifyConfigured() && <p className="text-xs text-muted">Not available until the Shopify app credentials are configured on the server.</p>}
            </form>
          )}
          <p className="mt-3 text-xs text-muted">On Shopify we can add structured data automatically. Meta descriptions and robots.txt changes are shown as steps for you to apply.</p>
        </Card>
      )}

      {crawl && showWpCard && (
        <Card>
          <SectionTitle>{platform === "unknown" && !connected ? "Is this a WordPress site?" : "WordPress connection"}</SectionTitle>
          {connected ? (
            <div className="space-y-2 text-sm">
              <p>
                Connected to <strong>{domain.wordpress!.siteUrl}</strong> as {domain.wordpress!.username} · plugin {domain.wordpress!.pluginVersion}
                {domain.wordpress!.yoast && " · Yoast SEO detected (fixes go through Yoast)"}
              </p>
              {domain.wordpress!.robotsFile && (
                <p className="rounded-xl bg-peach px-3 py-2 text-xs">
                  Your site has a robots.txt file in its web root, which WordPress can&apos;t change. Crawler-access fixes won&apos;t take effect until that file is edited or removed.
                </p>
              )}
              <form action={disconnectWp.bind(null, domain.id)}>
                <button className="text-xs text-muted underline underline-offset-4 hover:text-ink">Disconnect</button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>
                  <a href="/api/plugin" className="inline-flex items-center gap-1 underline underline-offset-4">
                    <Download className="size-3.5" /> Download the Visibility Connector plugin
                  </a>{" "}
                  and upload it in WordPress (Plugins → Add New → Upload Plugin), then activate it.
                </li>
                <li>In WordPress, open Users → Profile, scroll to Application Passwords, and create one named &quot;Visibility&quot;.</li>
                <li>Paste it below. We store it encrypted and only use it to apply and undo fixes.</li>
              </ol>
              <ConnectWpForm domainId={domain.id} defaultUrl={`https://${domain.hostname}`} />
            </div>
          )}
        </Card>
      )}

      {crawl && !autoFix && (
        <Card className="bg-sky">
          <p className="font-semibold">Automatic fixes aren&apos;t available for {PLATFORM_LABELS[platform]} sites yet.</p>
          <p className="mt-1 text-sm text-ink/75">
            Below is exactly what to add and where. {platform === "unknown" ? "If this is actually a WordPress site, connect it above to apply fixes automatically." : ""}
          </p>
        </Card>
      )}

      {crawl && (
        <Card>
          <SectionTitle>Suggested fixes · {open.length}</SectionTitle>
          {open.length === 0 && blocked.length === 0 && <p className="text-sm text-muted">Nothing we can apply automatically from this audit.</p>}
          <ul className="space-y-3">
            {open.map((p) => {
              const failed = active.get(p.key)?.status === "failed" ? active.get(p.key)!.error : null;
              const howTo = guidanceFor(platform, p.findingCode)?.howTo;
              return (
                <li key={p.key} className="space-y-2 rounded-2xl bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <EvidenceBadge evidence={p.evidence} />
                    <p className="font-semibold">{p.title}</p>
                  </div>
                  <p className="text-xs text-muted">{p.why}</p>
                  {failed && <p className="text-xs text-high">Last attempt failed: {failed}</p>}
                  {canApply(p) ? (
                    <ApplyFixForm domainId={domain.id} fixKey={p.key} editableText={p.editableText ? String(p.payload.text) : undefined} disabled={!connected} />
                  ) : (
                    <>
                      {howTo && <p className="text-xs">{howTo}</p>}
                      <CopyBlock
                        label={p.type === "jsonld" ? "Code to add" : p.type === "meta_description" ? "Suggested description" : "Allow these crawlers"}
                        code={p.type === "jsonld" ? scriptTag(p.payload.data as object) : p.type === "meta_description" ? String(p.payload.text) : (p.payload.agents as string[]).map((a) => `User-agent: ${a}\nAllow: /`).join("\n\n")}
                      />
                    </>
                  )}
                </li>
              );
            })}
            {blocked.map((b) => (
              <li key={b.title} className="rounded-2xl border border-dashed border-line p-4 text-sm">
                <p className="font-semibold">{b.title}</p>
                <p className="mt-1 text-xs text-muted">
                  Needs your brand details first.{" "}
                  <Link href={`/dashboard/entity/${domain.id}`} className="underline underline-offset-4">
                    Fill in your brand profile
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {domain.fixes.length > 0 && (
        <Card>
          <SectionTitle>Applied fixes</SectionTitle>
          <ul className="space-y-2">
            {domain.fixes.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 rounded-2xl bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${STATUS[f.status]?.tone ?? "bg-panel"}`}>{STATUS[f.status]?.label ?? f.status}</span>
                    <p className="truncate text-sm font-semibold">{f.title}</p>
                  </div>
                  {f.error && f.status !== "failed" && <p className="mt-1 text-xs text-muted">{f.error}</p>}
                  <p className="mt-1 text-[11px] text-muted">
                    {f.appliedAt ? `Applied ${f.appliedAt.toLocaleString()}` : ""}
                    {f.rolledBackAt ? ` · rolled back ${f.rolledBackAt.toLocaleString()}` : ""}
                  </p>
                </div>
                {f.status !== "rolled_back" && f.status !== "failed" && (
                  <div className="flex shrink-0 gap-2">
                    <form action={recheckFix.bind(null, f.id)}>
                      <button className="rounded-full border border-line px-3 py-1.5 text-xs hover:border-ink">Check again</button>
                    </form>
                    <form action={rollbackAppliedFix.bind(null, f.id)}>
                      <button className="rounded-full border border-line px-3 py-1.5 text-xs hover:border-ink">Roll back</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
