import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const PLUGIN_DIR = path.join(process.cwd(), "integrations/wordpress/visibility-connector");

// Zips the plugin folder on request so the download always matches the deployed code.
export async function GET() {
  const zip = new JSZip();
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else zip.file(`${prefix}${entry.name}`, fs.readFileSync(full));
    }
  };
  walk(PLUGIN_DIR, "visibility-connector/");
  const body = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(body as BodyInit, {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="visibility-connector.zip"' },
  });
}
