import { entitySchema, type EntityProfile } from "@/lib/entity";

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const MAX_AUTHOR_SLOTS = 20;

// Author fields are named author.<i>.<field>; a slot with no name is treated as empty and dropped.
export function parseEntityForm(form: FormData) {
  const authors = [];
  for (let i = 0; i < MAX_AUTHOR_SLOTS; i++) {
    const name = String(form.get(`author.${i}.name`) ?? "").trim();
    if (!name) continue;
    authors.push({
      name,
      jobTitle: String(form.get(`author.${i}.jobTitle`) ?? ""),
      url: String(form.get(`author.${i}.url`) ?? ""),
      image: String(form.get(`author.${i}.image`) ?? ""),
      bio: String(form.get(`author.${i}.bio`) ?? ""),
      knowsAbout: lines(form.get(`author.${i}.knowsAbout`)),
      sameAs: lines(form.get(`author.${i}.sameAs`)),
    });
  }
  return entitySchema.safeParse({
    name: form.get("name"),
    legalName: String(form.get("legalName") ?? ""),
    url: form.get("url"),
    logo: String(form.get("logo") ?? ""),
    description: String(form.get("description") ?? ""),
    foundingDate: String(form.get("foundingDate") ?? ""),
    email: String(form.get("email") ?? ""),
    telephone: String(form.get("telephone") ?? ""),
    sameAs: lines(form.get("sameAs")),
    authors,
  });
}

// Starting point before the user has saved anything: brand name and the site's own address.
export function defaultEntity(hostname: string, brandName: string | null, existingSameAs: string[] = []): EntityProfile {
  return { name: brandName || hostname.replace(/^www\./, "").split(".")[0], url: `https://${hostname}`, sameAs: existingSameAs, authors: [] };
}

export function loadEntity(record: { data: string } | null, fallback: EntityProfile): EntityProfile {
  if (!record) return fallback;
  const parsed = entitySchema.safeParse(JSON.parse(record.data));
  return parsed.success ? parsed.data : fallback;
}
