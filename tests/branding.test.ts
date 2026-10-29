import { test } from "node:test";
import assert from "node:assert/strict";
import { brandFor, brandingSchema, textOn } from "@/lib/branding";
import { APP_NAME } from "@/lib/brand";

const none = { brandName: null, brandLogoUrl: null, brandColor: null, reportFooter: null };
const agency = { kind: "agency", brandName: "Northwind SEO", brandLogoUrl: "https://nw.example/logo.png", brandColor: "#1f3a93", reportFooter: "Prepared by Northwind" };

test("clients inherit the agency brand; agencies use their own; others see the product brand", () => {
  const client = brandFor({ kind: "client", ...none }, agency);
  assert.equal(client.name, "Northwind SEO");
  assert.equal(client.whiteLabel, true);
  assert.equal(client.reportFooter, "Prepared by Northwind");
  assert.equal(brandFor(agency, null).logoUrl, "https://nw.example/logo.png");
  assert.equal(brandFor({ kind: "standard", ...none, brandName: "Sneaky" }, null).name, APP_NAME, "branding is an agency feature");
  assert.equal(brandFor({ kind: "agency", ...none }, null).name, APP_NAME, "agency without a brand name keeps the default");
});

test("readable text on the accent colour", () => {
  assert.equal(textOn("#1f3a93"), "#ffffff");
  assert.equal(textOn("#e2f05c"), "#15161c");
  assert.equal(textOn("#000000"), "#ffffff");
  assert.equal(textOn("#ffffff"), "#15161c");
});

test("branding form validation: https logo only, strict hex colour, blanks clear", () => {
  const ok = brandingSchema.parse({ brandName: " Northwind ", brandLogoUrl: "https://nw.example/l.png", brandColor: "#1F3A93", reportFooter: "" });
  assert.deepEqual(ok, { brandName: "Northwind", brandLogoUrl: "https://nw.example/l.png", brandColor: "#1f3a93", reportFooter: null });
  for (const bad of ["javascript:alert(1)", "http://nw.example/l.png", "data:image/svg+xml,<svg onload=alert(1)>", "not a url"]) {
    assert.equal(brandingSchema.safeParse({ brandLogoUrl: bad }).success, false, bad);
  }
  for (const bad of ["red", "#fff", "#12345g", "#1f3a93; background:url(x)"]) assert.equal(brandingSchema.safeParse({ brandColor: bad }).success, false, bad);
  assert.deepEqual(brandingSchema.parse({ brandName: "", brandLogoUrl: "", brandColor: "", reportFooter: "" }), { brandName: null, brandLogoUrl: null, brandColor: null, reportFooter: null });
});
