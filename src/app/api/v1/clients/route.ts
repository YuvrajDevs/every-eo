import { authenticate, listClients, respond } from "@/lib/api";

export const GET = (req: Request) => respond(async () => listClients((await authenticate(req.headers)).keyOrgId));
