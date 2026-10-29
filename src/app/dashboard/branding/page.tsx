import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Card, SectionTitle } from "@/components/ui";
import { BrandingForm } from "@/components/branding-form";

export default async function BrandingPage() {
  const { org } = await requireUser();
  if (org.kind !== "agency") notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">Branding</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          Your name, logo and colour replace ours across your workspace, every client workspace, and printed reports. Highlight text switches between dark and light automatically so it stays readable on your colour.
        </p>
      </div>
      <Card className="max-w-2xl">
        <SectionTitle>Your brand</SectionTitle>
        <BrandingForm values={{ brandName: org.brandName ?? "", brandLogoUrl: org.brandLogoUrl ?? "", brandColor: org.brandColor ?? "", reportFooter: org.reportFooter ?? "" }} />
      </Card>
    </div>
  );
}
