import http from "node:http";

export const WORDS = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(" ");
const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const PAGES: Record<string, string> = {
  "/": page(
    `<title>Acme Mail Scanning – Open Your Mail Remotely</title><meta name="description" content="Acme scans and forwards your physical mail so you can read it from anywhere in the world, any time.">
     <script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Acme" })}</script>`,
    `<h1>Acme</h1><p>${WORDS(40)}</p><a href="/about">About</a> <a href="/blog/guide">Guide</a> <a href="/spa">App</a> <a href="/gone">Gone</a>`,
  ),
  "/about": page("", `<h1>About</h1><h1>Again</h1><p>short</p>`),
  "/blog/guide": page(
    `<title>The Complete Guide to Remote Mail</title><meta name="description" content="A long guide covering how remote mail scanning works, what it costs, and how to pick a provider for your business.">
     <script type="application/ld+json">${JSON.stringify({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Totally invisible question text?" }] })}</script>`,
    `<h1>Guide</h1><p>${WORDS(40)}</p><h2>What is remote mail?</h2><p>${WORDS(320)}</p><h2>How much does it cost?</h2><ul><li>a</li><li>b</li><li>c</li></ul><p>${WORDS(100)}</p>`,
  ),
  "/spa": page(
    `<title>App</title><meta name="description" content="A single page application that renders everything with JavaScript after the page loads in the browser.">`,
    `<h1>App</h1><div id="root"></div>${[1, 2, 3, 4, 5, 6].map((i) => `<script src="/s${i}.js"></script>`).join("")}`,
  ),
};
const SPA_JS = `document.getElementById('root').innerHTML='<p>'+${JSON.stringify(WORDS(400))}+'</p>';`;



export function startFixture(port = 80) {
  const server = http.createServer((req, res) => {
    const ua = req.headers["user-agent"] ?? "";
    const path = (req.url ?? "/").split("?")[0];
    if (ua.includes("OAI-SearchBot")) {
      res.writeHead(403).end("Access denied");
      return;
    }
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: PerplexityBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: http://localhost/sitemap.xml\n");
    } else if (path === "/sitemap.xml") {
      const urls = ["/", "/about", "/blog/guide", "/spa", "/orphan"].map((p) => `<url><loc>http://localhost${p}</loc></url>`).join("");
      res.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><urlset>${urls}</urlset>`);
    } else if (path === "/orphan") {
      res.writeHead(200, { "content-type": "text/html" }).end(page("<title>Orphan</title>", `<h1>Orphan</h1><p>${WORDS(30)}</p>`));
    } else if (/^\/s\d\.js$/.test(path)) {
      res.writeHead(200, { "content-type": "application/javascript" }).end(path === "/s1.js" ? SPA_JS : "");
    } else if (PAGES[path]) {
      res.writeHead(200, { "content-type": "text/html" }).end(PAGES[path]);
    } else {
      res.writeHead(404, { "content-type": "text/html" }).end("nope");
    }
  });
  return new Promise<http.Server>((resolve) => server.listen(port, () => resolve(server)));
}
