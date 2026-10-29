import "server-only";
import { redirect } from "next/navigation";
import { resolveAccess } from "@/lib/access";
import { readSession } from "@/lib/session";

export async function requireUser() {
  const session = await readSession();
  if (!session) redirect("/login");
  const access = await resolveAccess(session.userId, session.orgId);
  if (!access) redirect("/login");
  return access;
}
