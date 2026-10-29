import { authenticate, respond, siteAudit } from "@/lib/api";

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  respond(async () => siteAudit((await authenticate(req.headers)).orgId, (await ctx.params).id));
