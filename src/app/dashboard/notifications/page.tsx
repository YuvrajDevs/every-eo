import { requireUser } from "@/lib/auth";
import { mailConfigured } from "@/lib/mailer";
import { Card, SectionTitle } from "@/components/ui";
import { NotificationsForm } from "@/components/notifications-form";

export default async function NotificationsPage() {
  const { org } = await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">Email</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">Alerts when something changes for the worse, and a regular summary for you or your client. Reports carry your agency&apos;s branding when white-label is set up.</p>
      </div>
      {!mailConfigured() && <Card className="bg-peach text-sm">Email sending isn&apos;t configured on this server yet (SMTP_URL). Settings are saved and take effect once it is.</Card>}
      <Card className="max-w-2xl">
        <SectionTitle>{org.name}</SectionTitle>
        <NotificationsForm values={{ alertEmails: org.alertEmails, reportSchedule: org.reportSchedule, reportRecipients: org.reportRecipients ?? "" }} />
      </Card>
    </div>
  );
}
