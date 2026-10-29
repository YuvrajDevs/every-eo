import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Circle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorBioHtml, entityChecklist, organizationJsonLd, personJsonLd, scriptTag, wikidataQuickStatements } from "@/lib/entity";
import { defaultEntity, loadEntity } from "@/lib/entity-form";
import { Card, SectionTitle } from "@/components/ui";
import { CopyBlock } from "@/components/copy-block";
import { EntityForm } from "@/components/entity-form";

export default async function EntityPage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id }, include: { entity: true } });
  if (!domain) notFound();
  const entity = loadEntity(domain.entity, defaultEntity(domain.hostname, domain.brandName));
  const checklist = entityChecklist(entity);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/sites" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> Websites
        </Link>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Brand profile</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          Tells search and AI engines exactly who {domain.hostname} is, and who writes for it. Entity signals are widely recommended but their effect on AI citations isn&apos;t experimentally proven; third-party profiles and mentions matter more than markup alone.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <SectionTitle>Details</SectionTitle>
          <EntityForm domainId={domain.id} entity={entity} />
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionTitle>Checklist</SectionTitle>
            <ul className="space-y-2 text-sm">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-start gap-2">
                  {c.done ? <Check className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" />}
                  <span className={c.done ? "" : "text-muted"}>{c.label}</span>
                </li>
              ))}
            </ul>
          </Card>
          {domain.entity && (
            <Card className="space-y-5">
              <SectionTitle>Generated code</SectionTitle>
              <CopyBlock label="Organization schema (homepage <head>)" code={scriptTag(organizationJsonLd(entity))} />
              {entity.authors.map((a) => (
                <div key={a.name} className="space-y-5">
                  <CopyBlock label={`${a.name}: Person schema (author page)`} code={scriptTag(personJsonLd(a, entity))} />
                  <CopyBlock label={`${a.name}: visible author box (below articles)`} code={authorBioHtml(a)} />
                </div>
              ))}
              <CopyBlock label="Wikidata draft (QuickStatements, review before submitting)" code={wikidataQuickStatements(entity)} />
              <p className="text-[11px] text-muted">
                Wikidata items need independent references to survive review. Add sources for each statement before submitting.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
