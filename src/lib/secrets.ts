import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM for third-party credentials at rest. Uses ENCRYPTION_KEY (32 bytes, base64) when set; otherwise a key
// derived from SESSION_SECRET, so local setups work without extra config. Rotating either makes stored secrets unreadable.
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return k;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Set ENCRYPTION_KEY or a SESSION_SECRET of at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "visibility", "credential-encryption", 32));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
