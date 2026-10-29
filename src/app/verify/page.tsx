import Link from "next/link";
import { consumeVerificationToken } from "@/lib/verification";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const ok = token ? Boolean(await consumeVerificationToken(token)) : false;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md rounded-3xl bg-surface p-8 text-center">
        <h1 className="font-display text-3xl">{ok ? "Email confirmed" : "This link doesn't work"}</h1>
        <p className="mt-3 text-sm text-muted">{ok ? "Thanks — your email address is confirmed." : "It may have expired or already been used. Log in and request a new one."}</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm text-accent-ink">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
