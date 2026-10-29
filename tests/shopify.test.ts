import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { Liquid } from "liquidjs";

process.env.AUDIT_TEST_ALLOW_PRIVATE = "1";
process.env.DATABASE_URL = "file:./shopify-test.db";
process.env.SESSION_SECRET ??= "shopify-test-secret-shopify-test-secret";
process.env.SHOPIFY_API_KEY = "key_123";
process.env.SHOPIFY_API_SECRET = "secret_456";
process.env.SHOPIFY_TEST_ADMIN_BASE = "http://localhost:8095";

const SECRET = "secret_456";
const TEMPLATE = fs.readFileSync("integrations/shopify/extensions/visibility-schema/blocks/schema.liquid", "utf8").replace(/{% schema %}[\s\S]*{% endschema %}/, "");
const liquid = new Liquid();

// Mock of the parts of Shopify we call: OAuth token exchange and Admin GraphQL (app-installation metafields).
const metafields = new Map<string, string>();
const calls: string[] = [];
let admin: http.Server;
let storefront: http.Server;

before(async () => {
  fs.rmSync("shopify-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
  admin = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url === "/admin/oauth/access_token") {
      const j = JSON.parse(body);
      calls.push(`token:${j.code}`);
      if (j.client_secret !== SECRET || j.code !== "good-code") return void res.writeHead(400).end("{}");
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "shpat_abc", scope: "read_themes" }));
    }
    if (req.url?.startsWith("/admin/api/") && req.url.endsWith("/graphql.json")) {
      if (req.headers["x-shopify-access-token"] !== "shpat_abc") return void res.writeHead(401).end("{}");
      const { query, variables } = JSON.parse(body);
      if (query.includes("currentAppInstallation")) return void res.end(JSON.stringify({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } }));
      if (query.includes("metafieldsSet")) {
        for (const m of variables.m) {
          assert.equal(m.ownerId, "gid://shopify/AppInstallation/1");
          assert.equal(m.namespace, "visibility");
          metafields.set(m.key, m.value);
        }
        calls.push("metafieldsSet");
        return void res.end(JSON.stringify({ data: { metafieldsSet: { userErrors: [] } } }));
      }
      if (query.includes("appInstallation(id")) {
        const v = metafields.get(variables.key);
        return void res.end(JSON.stringify({ data: { appInstallation: { metafield: v ? { value: v } : null } } }));
      }
    }
    res.writeHead(404).end("{}");
  });
  // Storefront: renders the real theme-embed Liquid with whatever the platform saved.
  storefront = http.createServer(async (req, res) => {
    const pageType = req.url === "/" ? "index" : "product";
    const head = await liquid.parseAndRender(TEMPLATE, {
      request: { page_type: pageType },
      app: { metafields: { visibility: { head_home: { value: metafields.get("head_home") ?? "" }, head_site: { value: metafields.get("head_site") ?? "" } } } },
    });
    res.writeHead(200, { "content-type": "text/html" }).end(`<html><head><title>Store</title>${head}</head><body>shop</body></html>`);
  });
  await new Promise<void>((r) => admin.listen(8095, r));
  await new Promise<void>((r) => storefront.listen(80, r));
});

after(async () => {
  admin.close();
  storefront.close();
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("shopify-test.db", { force: true });
});

const signQuery = (params: Record<string, string>) => {
  const msg = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return new URLSearchParams({ ...params, hmac: createHmac("sha256", SECRET).update(msg).digest("hex") });
};

test("shop names: only *.myshopify.com, with shorthand", async () => {
  const { normalizeShop } = await import("@/lib/shopify");
  assert.equal(normalizeShop("My-Store"), "my-store.myshopify.com");
  assert.equal(normalizeShop("https://my-store.myshopify.com/admin"), "my-store.myshopify.com");
  for (const bad of ["evil.com", "my-store.myshopify.com.evil.com", "-x.myshopify.com", "a b.myshopify.com", "my_store"]) assert.equal(normalizeShop(bad), null, bad);
});

test("query and webhook HMACs", async () => {
  const { verifyQueryHmac, verifyWebhookHmac } = await import("@/lib/shopify");
  const q = signQuery({ shop: "a.myshopify.com", code: "c", state: "s", timestamp: "1" });
  assert.equal(verifyQueryHmac(q), true);
  q.set("shop", "b.myshopify.com");
  assert.equal(verifyQueryHmac(q), false);
  assert.equal(verifyQueryHmac(new URLSearchParams({ shop: "a" })), false);
  const body = '{"id":1}';
  const sig = createHmac("sha256", SECRET).update(body).digest("base64");
  assert.equal(verifyWebhookHmac(body, sig), true);
  assert.equal(verifyWebhookHmac(body + " ", sig), false);
  assert.equal(verifyWebhookHmac(body, null), false);
});

let orgId = "";
let domainId = "";

test("OAuth callback: rejects forged, mismatched and cross-org requests, then installs", async () => {
  const { db } = await import("@/lib/db");
  const { completeInstall } = await import("@/lib/shopify-install");
  const org = await db.organization.create({ data: { name: "Store Co" } });
  const otherOrg = await db.organization.create({ data: { name: "Other" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost" } });
  orgId = org.id;
  domainId = domain.id;
  const params = { shop: "my-store.myshopify.com", code: "good-code", state: "st4te", timestamp: "1700000000" };
  const cookie = `st4te.${domain.id}.my-store.myshopify.com`;

  const forged = new URLSearchParams({ ...params, hmac: "00" });
  assert.match(JSON.stringify(await completeInstall(forged, cookie, org.id)), /bad signature/);
  assert.match(JSON.stringify(await completeInstall(signQuery(params), `other.${domain.id}.my-store.myshopify.com`, org.id)), /expired/);
  assert.match(JSON.stringify(await completeInstall(signQuery(params), `st4te.${domain.id}.evil-store.myshopify.com`, org.id)), /expired/);
  assert.match(JSON.stringify(await completeInstall(signQuery(params), cookie, otherOrg.id)), /isn't in your workspace/);
  await assert.rejects(completeInstall(signQuery({ ...params, code: "bad-code" }), cookie, org.id), /refused the install/);

  const ok = await completeInstall(signQuery(params), cookie, org.id);
  assert.deepEqual(ok, { domainId: domain.id });
  const conn = await db.shopifyConnection.findUniqueOrThrow({ where: { domainId: domain.id } });
  assert.equal(conn.installationId, "gid://shopify/AppInstallation/1");
  assert.ok(!conn.token.includes("shpat_abc"));
  const { decrypt } = await import("@/lib/secrets");
  assert.equal(decrypt(conn.token), "shpat_abc");
});

test("Organization schema: written to app metafields, rendered by the theme embed on the homepage only, verified, rolled back", async () => {
  const { applyFix, rollbackFix } = await import("@/lib/fix-engine");
  const { proposeFixes } = await import("@/lib/fixes");
  const { entitySchema } = await import("@/lib/entity");
  const entity = entitySchema.parse({ name: "Shop </script> Co", url: "https://my-store.com", sameAs: ["https://www.instagram.com/shopco"] });
  const { proposals } = proposeFixes({ homepage: "http://localhost/", hostname: "localhost", entity, pages: [], findings: [{ code: "organization_no_sameas", url: null }] });
  const fix = await applyFix(orgId, domainId, proposals[0]);
  assert.equal(fix.status, "verified", fix.error ?? "");
  const home = await (await fetch("http://localhost/")).text();
  assert.equal((home.match(/application\/ld\+json/g) ?? []).length, 1);
  assert.ok(!home.includes("Shop </script> Co"), "value cannot close the script tag");
  const product = await (await fetch("http://localhost/products/x")).text();
  assert.ok(!product.includes("ld+json"), "homepage-only data stays off product pages");

  const again = await applyFix(orgId, domainId, proposals[0]);
  assert.equal(again.id, fix.id);
  assert.equal(((await (await fetch("http://localhost/")).text()).match(/ld\+json/g) ?? []).length, 1, "no duplicate after re-apply");

  await rollbackFix(fix.id);
  assert.ok(!(await (await fetch("http://localhost/")).text()).includes("ld+json"));
});

test("fix types the theme embed can't apply fail clearly instead of pretending", async () => {
  const { applyFix } = await import("@/lib/fix-engine");
  const fix = await applyFix(orgId, domainId, { key: "meta:/p", type: "meta_description", findingCode: "missing_meta_description", title: "t", why: "", evidence: "proven", url: "http://localhost/p", payload: { text: "hello there" } });
  assert.equal(fix.status, "failed");
  assert.match(fix.error!, /can't be applied automatically on Shopify/);
});

test("webhooks: signature required; app/uninstalled removes the connection", async () => {
  const { POST } = await import("@/app/api/shopify/webhooks/route");
  const { db } = await import("@/lib/db");
  const body = JSON.stringify({ id: 1 });
  const req = (sig: string) => new Request("http://x/api/shopify/webhooks", { method: "POST", body, headers: { "x-shopify-hmac-sha256": sig, "x-shopify-topic": "app/uninstalled", "x-shopify-shop-domain": "my-store.myshopify.com" } });
  assert.equal((await POST(req("bogus"))).status, 401);
  assert.equal(await db.shopifyConnection.count(), 1);
  assert.equal((await POST(req(createHmac("sha256", SECRET).update(body).digest("base64")))).status, 200);
  assert.equal(await db.shopifyConnection.count(), 0);
});

test("theme embed template renders sitewide data everywhere and home data only on the homepage", async () => {
  const ctx = (pageType: string) => ({ request: { page_type: pageType }, app: { metafields: { visibility: { head_site: { value: "<site>" }, head_home: { value: "<home>" } } } } });
  const home = await liquid.parseAndRender(TEMPLATE, ctx("index"));
  const other = await liquid.parseAndRender(TEMPLATE, ctx("collection"));
  assert.ok(home.includes("<site>") && home.includes("<home>"));
  assert.ok(other.includes("<site>") && !other.includes("<home>"));
  const empty = await liquid.parseAndRender(TEMPLATE, { request: { page_type: "index" }, app: { metafields: { visibility: {} } } });
  assert.equal(empty.trim(), "");
});
