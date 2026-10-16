import webpush, { type PushSubscription, WebPushError } from "web-push";
import { sendNtfy } from "./ntfy";

export interface AlertMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface AlertChannels {
  push: PushSubscription | null;
  ntfyTopic: string;
  email: string;
}

export interface AlertResult {
  push?: "sent" | "expired" | "failed";
  ntfy?: "sent" | "failed";
  email?: "sent" | "failed";
}

let vapidReady: boolean | undefined;

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function ensureVapid() {
  if (vapidReady !== undefined) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  vapidReady = Boolean(pub && priv);
  if (vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:contact@lycapps.com",
      pub!,
      priv!,
    );
  }
  return vapidReady;
}

export function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_FROM);
}

async function sendEmail(to: string, msg: AlertMessage) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM,
      to,
      subject: msg.title,
      text: `${msg.body}${msg.url ? `\n\n${msg.url}` : ""}`,
    }),
  });
  if (!res.ok) throw new Error(`Resend: HTTP ${res.status}`);
}

export async function sendAlert(channels: AlertChannels, msg: AlertMessage): Promise<AlertResult> {
  const result: AlertResult = {};
  const jobs: Promise<void>[] = [];

  if (channels.push && ensureVapid()) {
    jobs.push(
      webpush
        .sendNotification(channels.push, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "high" })
        .then(() => void (result.push = "sent"))
        .catch((err) => {
          const gone = err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
          result.push = gone ? "expired" : "failed";
        }),
    );
  }
  if (channels.ntfyTopic) {
    jobs.push(
      sendNtfy(channels.ntfyTopic, msg.title, msg.body, msg.url)
        .then(() => void (result.ntfy = "sent"))
        .catch(() => void (result.ntfy = "failed")),
    );
  }
  if (channels.email && emailEnabled()) {
    jobs.push(
      sendEmail(channels.email, msg)
        .then(() => void (result.email = "sent"))
        .catch(() => void (result.email = "failed")),
    );
  }

  await Promise.all(jobs);
  return result;
}
