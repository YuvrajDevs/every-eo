import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const PLUGIN_DIR = path.join(process.cwd(), "integrations/wordpress/visibility-connector");

let cached: Uint8Array | null = null;

// Zips the plugin folder once per server start (it only changes on deploy), then serves the cached zip.
export async function GET() {
  if (cached) return zipResponse(cached);
  const zip = new JSZip();
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else zip.file(`${prefix}${entry.name}`, fs.readFileSync(full));
    }
  };
  walk(PLUGIN_DIR, "visibility-connector/");
  cached = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return zipResponse(cached);
}

function zipResponse(body: Uint8Array) {
  return new Response(body as BodyInit, {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="visibility-connector.zip"' },
  });
}
