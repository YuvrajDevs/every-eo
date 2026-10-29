import nodemailer, { type Transporter } from "nodemailer";

// Sends email through SMTP when SMTP_URL is set (e.g. smtps://user:pass@smtp.example.com:465). Without it, messages
// are printed to the server log so local development and tests work with no mail provider.
export type Mail = { to: string; subject: string; text: string; html?: string; fromName?: string };

let transport: Transporter | null = null;

export function mailConfigured() {
  return Boolean(process.env.SMTP_URL);
}

export async function sendMail(mail: Mail) {
  const from = process.env.MAIL_FROM || "no-reply@localhost";
  if (!mailConfigured()) {
    console.log(`[mail] (SMTP_URL not set) to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return { delivered: false };
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: mail.fromName ? { name: mail.fromName.replace(/[\r\n"<>]/g, "").slice(0, 60), address: from } : from,
    to: mail.to,
    subject: mail.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: mail.text,
    html: mail.html,
  });
  return { delivered: true };
}

export function resetMailer() {
  transport = null;
}
