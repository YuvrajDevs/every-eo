import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isStaff } from "@/lib/staff";

// Call from every staff page (not only the layout): Next.js renders layouts and pages in parallel, so a check in the
// layout alone doesn't stop a page's data from being streamed.
export async function requireStaff() {
  const access = await requireUser();
  if (!isStaff(access.user)) notFound();
  return access;
}
