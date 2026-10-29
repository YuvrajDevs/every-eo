import { db } from "@/lib/db";
import { defaultEntity, loadEntity } from "@/lib/entity-form";
import { proposeFixes } from "@/lib/fixes";

// Fix proposals are always rebuilt from the latest completed audit, so the page and the apply action agree.
export async function loadFixContext(domain: { id: string; hostname: string; brandName: string | null }) {
  const crawl = await db.crawl.findFirst({
    where: { domainId: domain.id, status: "completed" },
    orderBy: { createdAt: "desc" },
    include: { findings: true, pages: true },
  });
  const record = await db.entityRecord.findUnique({ where: { domainId: domain.id } });
  const entity = record ? loadEntity(record, defaultEntity(domain.hostname, domain.brandName)) : null;
  const homepage = crawl?.pages.find((p) => new URL(p.url).pathname === "/")?.url ?? `https://${domain.hostname}/`;
  const { proposals, blocked } = crawl
    ? proposeFixes({ homepage, hostname: domain.hostname, entity, pages: crawl.pages, findings: crawl.findings })
    : { proposals: [], blocked: [] };
  return { crawl, entity, proposals, blocked };
}
