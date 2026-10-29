import { SignupForm } from "@/components/forms";
import { AuthShell } from "@/components/auth-shell";
import { normalizeHostname } from "@/lib/url-safety";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  let hostname: string | undefined;
  try {
    hostname = typeof site === "string" && site ? normalizeHostname(site) : undefined;
  } catch {
    hostname = undefined;
  }
  return (
    <AuthShell title="Create your account" subtitle="Run your first audit in under a minute.">
      <SignupForm site={hostname} />
    </AuthShell>
  );
}
