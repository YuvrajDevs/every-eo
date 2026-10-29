import { SMTPServer } from "smtp-server";

// Local SMTP server that accepts every message and keeps the raw text, for testing email without a provider.
export async function startSmtpSink(port: number) {
  const messages: { to: string[]; raw: string }[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, session, cb) {
      let raw = "";
      stream.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      stream.on("end", () => {
        messages.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { messages, close: () => new Promise<void>((r) => server.close(() => r())) };
}
