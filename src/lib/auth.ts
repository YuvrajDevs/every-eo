import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export async function requireUser() {
  const session = await readSession();
  if (!session) redirect("/login");
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: session.userId, orgId: session.orgId } },
    include: { user: true, org: true },
  });
  if (!membership) redirect("/login");
  return { user: membership.user, org: membership.org, role: membership.role };
}
