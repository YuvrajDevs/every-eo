import { z } from "zod";
import { APP_NAME } from "@/lib/brand";

export type Brand = { name: string; logoUrl: string | null; color: string | null; onColor: string | null; reportFooter: string | null; whiteLabel: boolean };

type OrgBrand = { kind: string; brandName: string | null; brandLogoUrl: string | null; brandColor: string | null; reportFooter: string | null };

// Relative luminance (WCAG) to pick readable text on the agency's accent colour.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function textOn(hex: string) {
  const l = luminance(hex);
  // Compare contrast against near-black and white text; take the better one.
  const dark = (l + 0.05) / (luminance("#15161c") + 0.05);
  const light = 1.05 / (l + 0.05);
  return dark >= light ? "#15161c" : "#ffffff";
}

// Client workspaces show their agency's brand; agencies show their own; everyone else sees ours.
export function brandFor(org: OrgBrand, agency: OrgBrand | null): Brand {
  const source = org.kind === "client" && agency ? agency : org.kind === "agency" ? org : null;
  if (!source?.brandName) return { name: APP_NAME, logoUrl: null, color: null, onColor: null, reportFooter: null, whiteLabel: false };
  return {
    name: source.brandName,
    logoUrl: source.brandLogoUrl,
    color: source.brandColor,
    onColor: source.brandColor ? textOn(source.brandColor) : null,
    reportFooter: source.reportFooter,
    whiteLabel: true,
  };
}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const brandingSchema = z.object({
  brandName: z.preprocess(blankToNull, z.string().trim().min(2, "Brand name needs at least 2 characters").max(60).nullable()),
  brandLogoUrl: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(500)
      .refine((u) => {
        try {
          return new URL(u).protocol === "https:";
        } catch {
          return false;
        }
      }, "Logo must be an https:// image address")
      .nullable(),
  ),
  brandColor: z.preprocess(blankToNull, z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1a2b3c").transform((c) => c.toLowerCase()).nullable()),
  reportFooter: z.preprocess(blankToNull, z.string().trim().max(300).nullable()),
});
