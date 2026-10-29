import { db } from "@/lib/db";

export type JobPayloads = {
  crawl: { crawlId: string };
  visibility: { runId: string };
};

export async function enqueueJob<T extends keyof JobPayloads>(orgId: string, type: T, payload: JobPayloads[T]) {
  return db.job.create({ data: { orgId, type, payload: JSON.stringify(payload) } });
}
