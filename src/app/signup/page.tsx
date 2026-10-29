import { SignupForm } from "@/components/forms";
import { AuthShell } from "@/components/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" subtitle="Run your first audit in under a minute.">
      <SignupForm />
    </AuthShell>
  );
}
