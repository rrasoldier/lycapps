/** Push to a phone through https://ntfy.sh (free, no account, CORS-enabled). */
export async function sendNtfy(topic: string, title: string, body: string, url?: string) {
  if (!topic) return;
  // Query parameters instead of headers so accented titles survive.
  const target = new URL(`https://ntfy.sh/${encodeURIComponent(topic)}`);
  target.searchParams.set("title", title);
  target.searchParams.set("tags", "iphone,tada");
  target.searchParams.set("priority", "high");
  if (url) target.searchParams.set("click", url);
  const res = await fetch(target, { method: "POST", body });
  if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
}
