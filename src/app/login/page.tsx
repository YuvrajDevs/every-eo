import { LoginForm } from "@/components/forms";
import { AuthShell } from "@/components/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Log in to see your websites and reports.">
      <LoginForm />
    </AuthShell>
  );
}
