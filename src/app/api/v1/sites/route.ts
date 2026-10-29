import { authenticate, listSites, respond } from "@/lib/api";

export const GET = (req: Request) => respond(async () => listSites((await authenticate(req.headers)).orgId));
