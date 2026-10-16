export type NotificationState = NotificationPermission | "unsupported";

export function notificationState(): NotificationState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotifications(): Promise<NotificationState> {
  if (notificationState() === "unsupported") return "unsupported";
  return Notification.requestPermission();
}

export function showNotification(title: string, body: string, url?: string) {
  if (notificationState() !== "granted") return;
  const n = new Notification(title, {
    body,
    icon: "/logo.svg",
    tag: url ?? title,
    requireInteraction: true,
  });
  n.onclick = () => {
    window.focus();
    if (url) window.open(url, "_blank", "noopener");
    n.close();
  };
}

export function playChime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}
