// Local catch-all mailbox for development: set SMTP_URL="smtp://127.0.0.1:2525" in .env, then run
//   npm run mailbox
// Every email the app sends is printed here and saved as an .eml file in ./dev-mail (open it with any mail app).
import fs from "node:fs";
import path from "node:path";
import { SMTPServer } from "smtp-server";

const PORT = Number(process.env.MAILBOX_PORT ?? 2525);
const DIR = path.resolve("dev-mail");
fs.mkdirSync(DIR, { recursive: true });

const header = (raw: string, name: string) => raw.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, cb) {
    let raw = "";
    stream.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    stream.on("end", () => {
      const file = path.join(DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.eml`);
      fs.writeFileSync(file, raw);
      const to = session.envelope.rcptTo.map((r) => r.address).join(", ");
      console.log(`[mailbox] to=${to} subject=${header(raw, "Subject")} -> ${path.relative(process.cwd(), file)}`);
      cb();
    });
  },
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mailbox] listening on smtp://127.0.0.1:${PORT}, saving to ${DIR}`));
