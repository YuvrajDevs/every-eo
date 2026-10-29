import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "@/lib/csv";
import { parseGscQueries, suggestPrompts } from "@/lib/discovery";

test("CSV parser: quotes, escaped quotes, embedded commas/newlines, CRLF, BOM, blank lines", () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",2\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "2"]]);
});

test("Search Console export: header variants, thousands separators, percent CTR, bad rows skipped", () => {
  const csv = 'Top queries,Clicks,Impressions,CTR,Position\n"best mail scanning service",12,"1,204",1%,8.4\nacme mail,40,90,44.4%,1.2\n,3,4,1%,1\nbroken,x,y,,\n';
  const { rows, error } = parseGscQueries(csv);
  assert.equal(error, undefined);
  assert.deepEqual(rows[0], { query: "best mail scanning service", clicks: 12, impressions: 1204, ctr: 1, position: 8.4 });
  assert.equal(rows.length, 2);
  assert.match(parseGscQueries("Page,Clicks\n/x,1").error!, /Queries/);
  assert.match(parseGscQueries("").error!, /no rows/);
  assert.equal(parseGscQueries("Query,Clicks,Impressions\nhow to scan mail,1,2").rows.length, 1);
});

const base = {
  headings: [] as string[],
  gsc: [] as { query: string; clicks: number; impressions: number; ctr: number | null; position: number | null }[],
  category: null as string | null,
  competitors: [] as string[],
  brandTerms: ["acmemail", "acme"],
  brandName: "",
  existing: [] as string[],
};

test("suggestions: searches by impressions, branded queries excluded, short head terms skipped", () => {
  const s = suggestPrompts({
    ...base,
    gsc: [
      { query: "mail", clicks: 1, impressions: 9000, ctr: null, position: null },
      { query: "acme mail login", clicks: 50, impressions: 5000, ctr: null, position: null },
      { query: "how to get mail scanned while traveling", clicks: 2, impressions: 300, ctr: null, position: 11.2 },
      { query: "best virtual mailbox for small business", clicks: 5, impressions: 800, ctr: null, position: 6 },
    ],
  });
  assert.deepEqual(s.map((x) => x.text), ["best virtual mailbox for small business", "how to get mail scanned while traveling"]);
  assert.match(s[0].why, /800 Google impressions, average position 6\.0/);
});

test("suggestions: question headings from the site, existing prompts and duplicates removed", () => {
  const s = suggestPrompts({
    ...base,
    headings: ["How does remote mail scanning work?", "Pricing", "What is a virtual address", "How does Acme compare?", "How does remote mail scanning work?"],
    existing: ["what is a virtual address?"],
  });
  assert.deepEqual(s.map((x) => x.text), ["How does remote mail scanning work?"]);
});

test("suggestions: category and competitor templates; brand questions marked as about you", () => {
  const s = suggestPrompts({ ...base, category: "mail scanning service", competitors: ["Rival Mail"], brandName: "Acme Mail" });
  assert.ok(s.some((x) => x.text === "What is the best mail scanning service?"));
  assert.ok(s.some((x) => x.text === "What are the best alternatives to Rival Mail?"));
  const about = s.filter((x) => x.aboutYou);
  assert.deepEqual(about.map((x) => x.text), ["What does Acme Mail cost?", "Is Acme Mail any good?"]);
  assert.ok(s.length <= 30);
});
