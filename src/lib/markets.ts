// Markets a question can be asked from. The country goes to each engine's location setting where its API has one;
// the language is what the question should be written in (we don't translate questions).

export const MARKETS: { id: string; label: string; country: string; language: string }[] = [
  { id: "en-US", label: "United States · English", country: "US", language: "English" },
  { id: "en-GB", label: "United Kingdom · English", country: "GB", language: "English" },
  { id: "en-CA", label: "Canada · English", country: "CA", language: "English" },
  { id: "en-AU", label: "Australia · English", country: "AU", language: "English" },
  { id: "en-IN", label: "India · English", country: "IN", language: "English" },
  { id: "de-DE", label: "Germany · German", country: "DE", language: "German" },
  { id: "fr-FR", label: "France · French", country: "FR", language: "French" },
  { id: "es-ES", label: "Spain · Spanish", country: "ES", language: "Spanish" },
  { id: "es-MX", label: "Mexico · Spanish", country: "MX", language: "Spanish" },
  { id: "it-IT", label: "Italy · Italian", country: "IT", language: "Italian" },
  { id: "nl-NL", label: "Netherlands · Dutch", country: "NL", language: "Dutch" },
  { id: "pt-BR", label: "Brazil · Portuguese", country: "BR", language: "Portuguese" },
  { id: "ja-JP", label: "Japan · Japanese", country: "JP", language: "Japanese" },
];

export const marketInfo = (id: string | null | undefined) => (id ? MARKETS.find((m) => m.id === id) ?? null : null);

// BCP 47-ish check used by the hreflang audit: language (2-3 letters), optional script, optional region, or x-default.
const HREFLANG = /^(x-default|[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?)$/;
export const validHreflang = (v: string) => HREFLANG.test(v.replace(/^([a-z]+)-([a-z]{2})$/i, (_, l: string, r: string) => `${l.toLowerCase()}-${r.toUpperCase()}`).replace(/^[A-Z]{2,3}(?=$|-)/, (l) => l.toLowerCase()));
