import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/secrets";
import { safeFetch } from "@/lib/safe-fetch";
import { flattenJsonLd } from "@/worker/schema";
import { normalizeSiteUrl, wp, WpError, type WpCredentials } from "@/lib/wordpress";
import { remoteId, type ProposedFix } from "@/lib/fixes";

export async function connectWordPress(domainId: string, input: { siteUrl: string; username: string; appPassword: string }) {
  const creds = { siteUrl: normalizeSiteUrl(input.siteUrl), username: input.username.trim(), appPassword: input.appPassword.trim() };
  const status = await wp.status(creds); // throws WpError with a readable message
  const data = {
    siteUrl: creds.siteUrl,
    username: creds.username,
    secret: encrypt(creds.appPassword),
    pluginVersion: status.plugin,
    yoast: status.yoast,
    robotsFile: status.robots_file,
    lastCheckedAt: new Date(),
    lastError: null,
  };
  await db.wpConnection.upsert({ where: { domainId }, update: data, create: { domainId, ...data } });
  return status;
}

async function credentials(domainId: string): Promise<WpCredentials> {
  const c = await db.wpConnection.findUnique({ where: { domainId } });
  if (!c) throw new WpError("Connect your WordPress site first.", null);
  return { siteUrl: c.siteUrl, username: c.username, appPassword: decrypt(c.secret) };
}

export async function applyFix(orgId: string, domainId: string, p: ProposedFix, overrideText?: string) {
  const creds = await credentials(domainId);
  const payload = p.type === "meta_description" && overrideText?.trim() ? { ...p.payload, text: overrideText.trim().slice(0, 320) } : p.payload;
  const base = { orgId, domainId, key: p.key, type: p.type, findingCode: p.findingCode, title: p.title, url: p.url ?? null, payload: JSON.stringify(payload) };
  try {
    await wp.apply(creds, { id: remoteId(p.key), type: p.type, ...(p.url ? { url: p.url } : { sitewide: true }), payload });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return db.fix.upsert({ where: { domainId_key: { domainId, key: p.key } }, update: { ...base, status: "failed", error }, create: { ...base, status: "failed", error } });
  }
  const now = new Date();
  const fix = await db.fix.upsert({
    where: { domainId_key: { domainId, key: p.key } },
    update: { ...base, status: "applied", error: null, appliedAt: now, verifiedAt: null, rolledBackAt: null },
    create: { ...base, status: "applied", appliedAt: now },
  });
  return verifyFix(fix.id);
}

// Checks the public site actually serves the change, the way a crawler would see it.
export async function verifyFix(fixId: string) {
  const fix = await db.fix.findUniqueOrThrow({ where: { id: fixId }, include: { domain: { include: { wordpress: true } } } });
  const payload = JSON.parse(fix.payload);
  const site = fix.domain.wordpress?.siteUrl;
  let visible = false;
  let reason = "";
  try {
    if (fix.type === "robots_allow") {
      const robotsUrl = `${site}/robots.txt`;
      const res = await safeFetch(robotsUrl);
      const robots = robotsParser(robotsUrl, res.body);
      const stillBlocked = (payload.agents as string[]).filter((a) => robots.isAllowed(`${site}/`, a) === false);
      visible = stillBlocked.length === 0;
      reason = fix.domain.wordpress?.robotsFile
        ? "A robots.txt file in your web root overrides WordPress. Edit or delete that file, then check again."
        : `Still blocked in robots.txt: ${stillBlocked.join(", ")}.`;
    } else {
      const res = await safeFetch(fix.url!);
      const $ = cheerio.load(res.body);
      if (fix.type === "meta_description") {
        visible = $('meta[name="description"]').toArray().some((el) => $(el).attr("content") === payload.text);
      } else {
        const nodes = $('script[type="application/ld+json"]')
          .toArray()
          .flatMap((el) => {
            try {
              return flattenJsonLd(JSON.parse($(el).text()));
            } catch {
              return [];
            }
          });
        const want = payload.data["@type"];
        visible = nodes.some((n) => [n["@type"]].flat().includes(want) && (!payload.data.sameAs || JSON.stringify(n.sameAs ?? []).includes(payload.data.sameAs[0])));
      }
      reason = "Applied in WordPress but not visible on the live page yet. A caching plugin or CDN may be serving an old copy; clear the cache, then check again.";
    }
  } catch (err) {
    reason = `Couldn't load the live page to check: ${err instanceof Error ? err.message : String(err)}`;
  }
  return db.fix.update({
    where: { id: fix.id },
    data: visible ? { status: "verified", verifiedAt: new Date(), error: null } : { status: "not_visible", error: reason },
  });
}

export async function rollbackFix(fixId: string) {
  const fix = await db.fix.findUniqueOrThrow({ where: { id: fixId } });
  const creds = await credentials(fix.domainId);
  try {
    await wp.remove(creds, remoteId(fix.key));
  } catch (err) {
    // Already gone on the site (e.g. removed in wp-admin) counts as rolled back.
    if (!(err instanceof WpError && err.status === 404)) throw err;
  }
  return db.fix.update({ where: { id: fix.id }, data: { status: "rolled_back", rolledBackAt: new Date(), error: null } });
}
