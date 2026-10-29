import { db } from "@/lib/db";

// Who may act in a workspace: its own members, or members of the agency that owns it (role "agency").
// Kept free of Next.js imports so it can be tested directly.
export async function resolveAccess(userId: string, orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, include: { parent: true } });
  if (!org) return null;
  const direct = await db.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, include: { user: true } });
  if (direct) return { user: direct.user, org, role: direct.role, agency: org.kind === "client" ? org.parent : null };
  if (org.kind === "client" && org.parentId) {
    const viaAgency = await db.membership.findUnique({ where: { userId_orgId: { userId, orgId: org.parentId } }, include: { user: true } });
    if (viaAgency) return { user: viaAgency.user, org, role: "agency", agency: org.parent };
  }
  return null;
}

export async function createClientWorkspace(agencyId: string, name: string) {
  const agency = await db.organization.findUniqueOrThrow({ where: { id: agencyId } });
  if (agency.kind !== "agency") throw new Error("Only agency workspaces can add clients.");
  return db.organization.create({ data: { name, kind: "client", parentId: agency.id, plan: "agency_client" } });
}

// The workspace an agency user lands in after login: their agency, not a client.
export async function homeWorkspace(userId: string) {
  const m = await db.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  return m?.orgId ?? null;
}
