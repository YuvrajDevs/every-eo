import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Agent, fetch as undiciFetch } from "undici";
import { makeSafeLookup, UnsafeUrlError } from "@/lib/url-safety";

const asProd = async <T>(fn: () => Promise<T>) => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { node: env.NODE_ENV, allow: env.AUDIT_TEST_ALLOW_PRIVATE };
  env.NODE_ENV = "production";
  delete env.AUDIT_TEST_ALLOW_PRIVATE;
  try {
    return await fn();
  } finally {
    env.NODE_ENV = saved.node;
    if (saved.allow !== undefined) env.AUDIT_TEST_ALLOW_PRIVATE = saved.allow;
  }
};

test("DNS rebinding: the connection-time lookup refuses private addresses even if an earlier check passed", async () => {
  const server = http.createServer((_, res) => res.end("internal secret"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  // First resolution (the pre-check) says public; the connection-time resolution says 127.0.0.1.
  let calls = 0;
  const lookup = makeSafeLookup(async () => (++calls === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]));
  const preCheck = await new Promise<string>((resolve, reject) => lookup("rebind.example", {}, (err, addr) => (err ? reject(err) : resolve(String(addr)))));
  assert.equal(preCheck, "93.184.216.34");
  const dispatcher = new Agent({ connect: { lookup: lookup as never } });
  try {
    await asProd(async () => {
      await assert.rejects(undiciFetch(`http://rebind.example:${port}/`, { dispatcher }), (err: Error) => /Blocked non-public address/.test(String((err as { cause?: Error }).cause?.message ?? err.message)));
    });
  } finally {
    server.close();
    await dispatcher.close();
  }
});

test("safe lookup: all-addresses mode, mixed public/private answers, IPv6 loopback, empty answers", async () => {
  const run = (addrs: { address: string; family: number }[], opts: { all?: boolean } = {}) =>
    asProd(
      () =>
        new Promise<{ err: Error | null; addr: unknown }>((resolve) =>
          makeSafeLookup(async () => addrs)("h.example", opts, (err, addr) => resolve({ err, addr })),
        ),
    );
  assert.deepEqual((await run([{ address: "1.1.1.1", family: 4 }], { all: true })).addr, [{ address: "1.1.1.1", family: 4 }]);
  assert.ok((await run([{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.5", family: 4 }])).err instanceof UnsafeUrlError, "any private answer blocks");
  assert.ok((await run([{ address: "::1", family: 6 }])).err instanceof UnsafeUrlError);
  assert.ok((await run([{ address: "::ffff:7f00:1", family: 6 }])).err instanceof UnsafeUrlError);
  assert.ok((await run([])).err);
});
