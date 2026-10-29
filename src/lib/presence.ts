// Third-party presence: AI engines cite review sites, communities and reference works far more than brand sites.
// This ranks where to show up using two facts we already have (which hosts AI cited in your answers, and which
// profiles you've listed in your brand profile). It suggests work for a person to do; it never posts anywhere.

export type Channel = {
  id: string;
  label: string;
  host: RegExp;
  kind: "reviews" | "community" | "reference" | "directory" | "video" | "launch";
  claim: string[]; // steps to get a real presence
  caution?: string;
};

export const CHANNELS: Channel[] = [
  { id: "g2", label: "G2", host: /(^|\.)g2\.com$/, kind: "reviews", claim: ["Claim your free G2 seller profile.", "Complete the product description, pricing and screenshots.", "Ask recent happy customers for reviews (template below)."], caution: "Never pay for or script reviews; G2 removes them and it can get the profile flagged." },
  { id: "capterra", label: "Capterra", host: /(^|\.)(capterra|getapp|softwareadvice)\.com$/, kind: "reviews", claim: ["Create a free Gartner Digital Markets vendor account (covers Capterra, GetApp, Software Advice).", "Fill in categories, pricing and features accurately.", "Invite customers to review."] },
  { id: "trustpilot", label: "Trustpilot", host: /(^|\.)trustpilot\.com$/, kind: "reviews", claim: ["Claim your free business profile.", "Reply to existing reviews, including negative ones.", "Send review invitations after a completed purchase."] },
  { id: "reddit", label: "Reddit", host: /(^|\.)reddit\.com$/, kind: "community", claim: ["Find the subreddits where your category is discussed.", "Answer questions helpfully from a personal account that clearly says you work for the company.", "Share your expertise more than your product."], caution: "Undisclosed self-promotion and vote manipulation break Reddit's rules and backfire publicly." },
  { id: "wikipedia", label: "Wikipedia", host: /(^|\.)wikipedia\.org$/, kind: "reference", claim: ["Check notability first: you need several independent, reliable sources with significant coverage of the company.", "Don't write your own article. If you're notable, request one via Articles for Creation with your conflict of interest disclosed.", "Correct factual errors on existing articles through the talk page."], caution: "Paid or undisclosed editing violates Wikipedia's terms and usually gets deleted." },
  { id: "wikidata", label: "Wikidata", host: /(^|\.)wikidata\.org$/, kind: "reference", claim: ["Use the Wikidata draft on your Brand profile page.", "Add a reference for each statement (your site for basic facts, independent sources where possible)."] },
  { id: "crunchbase", label: "Crunchbase", host: /(^|\.)crunchbase\.com$/, kind: "directory", claim: ["Claim or create the organisation profile.", "Keep founding date, location, description and funding accurate."] },
  { id: "linkedin", label: "LinkedIn", host: /(^|\.)linkedin\.com$/, kind: "directory", claim: ["Create a company page with the same name, description and website as your site.", "Link team members' profiles to it."] },
  { id: "youtube", label: "YouTube", host: /(^|\.)(youtube\.com|youtu\.be)$/, kind: "video", claim: ["Publish short explainer and how-to videos that answer the questions you track.", "Write full descriptions and add chapters; engines read text, not video."] },
  { id: "producthunt", label: "Product Hunt", host: /(^|\.)producthunt\.com$/, kind: "launch", claim: ["Prepare a launch page with a clear one-line description.", "Launch when you have something new to show, and answer comments on the day."] },
];

// Domains that are search engines, the engines' own redirect hosts, or social share links: never PR targets.
const IGNORE = /(^|\.)(google\.[a-z.]+|bing\.com|vertexaisearch\.cloud\.google\.com|duckduckgo\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|t\.co)$/;

export type PresenceRow = {
  channel: Channel;
  listed: boolean;
  citedAnswers: number; // answers in the latest run that cite this channel
  priority: "high" | "medium" | "low";
  reason: string;
};

export function presence(input: { sameAs: string[]; answers: { citedHosts: string[] }[]; brandHost: string }) {
  const listedHosts = input.sameAs.flatMap((u) => {
    try {
      return [new URL(u).hostname.toLowerCase().replace(/^www\./, "")];
    } catch {
      return [];
    }
  });
  const total = input.answers.length;
  const rows: PresenceRow[] = CHANNELS.map((channel) => {
    const listed = listedHosts.some((h) => channel.host.test(h));
    const citedAnswers = input.answers.filter((a) => a.citedHosts.some((h) => channel.host.test(h))).length;
    const share = total ? citedAnswers / total : 0;
    const priority: PresenceRow["priority"] = !listed && citedAnswers > 0 ? "high" : !listed && channel.kind === "reviews" ? "medium" : listed && share >= 0.1 ? "medium" : "low";
    const reason =
      citedAnswers > 0
        ? `Cited in ${citedAnswers} of ${total} AI answers to your questions${listed ? "; keep your profile current" : ", and you're not listed"}.`
        : listed
          ? "You're listed; AI didn't cite it in your latest answers."
          : channel.kind === "reviews"
            ? "Review sites are among the sources AI engines cite most for product comparisons."
            : "Not cited in your latest answers.";
    return { channel, listed, citedAnswers, priority, reason };
  });
  const order = { high: 0, medium: 1, low: 2 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || b.citedAnswers - a.citedAnswers);

  // Other publications AI cites: candidates for digital PR, guest expertise or corrections.
  const counts = new Map<string, number>();
  for (const a of input.answers) {
    for (const h of new Set(a.citedHosts)) {
      if (h === input.brandHost || h.endsWith(`.${input.brandHost}`) || IGNORE.test(h) || CHANNELS.some((c) => c.host.test(h))) continue;
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
  }
  const publications = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([host, answers]) => ({ host, answers }));
  return { rows, publications, totalAnswers: total };
}

export function reviewRequestEmail(brand: string, site: string) {
  return `Subject: A quick favour? Two minutes to review ${brand}

Hi {first name},

Thanks for using ${brand}. If it's been useful, would you share an honest review on {site}? Reviews help other people decide, and we read every one.

{review link}

Whatever you write, good or bad, is fine by us.

Thanks,
{your name}
${site}`;
}

export function journalistPitch(brand: string, topic: string) {
  return `Subject: Data for your coverage of ${topic || "{topic}"}

Hi {name},

I saw your piece on {their article}. We run ${brand}, and we have {original data point, e.g. "anonymised figures from 40,000 customers"} on ${topic || "{topic}"} that hasn't been published anywhere.

Happy to share the numbers and methodology, or comment on the record. No strings attached.

{your name}, {role}`;
}
