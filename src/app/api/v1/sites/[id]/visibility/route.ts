import { authenticate, respond, siteVisibility } from "@/lib/api";

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  respond(async () => siteVisibility((await authenticate(req.headers)).orgId, (await ctx.params).id));
