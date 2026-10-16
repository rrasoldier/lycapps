import type { AvailabilityStatus, StoreAvailability } from "@/lib/apple-stock/types";

const STATUS_STYLES: Record<AvailabilityStatus, { label: string; pill: string; dot: string }> = {
  available: {
    label: "Disponible",
    pill: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
    dot: "bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400",
  },
  "not-yet": {
    label: "Pas encore",
    pill: "bg-amber-400/10 text-amber-200 ring-amber-400/25",
    dot: "bg-amber-300",
  },
  unavailable: {
    label: "Indisponible",
    pill: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/25",
    dot: "bg-zinc-500",
  },
};

export default function StoreCard({
  store,
  watched,
  onToggleWatch,
  variantLabel,
}: {
  store: StoreAvailability;
  watched: boolean;
  onToggleWatch: () => void;
  variantLabel: (partNumber: string, fallback: string) => string;
}) {
  const anyAvailable = store.parts.some((p) => p.status === "available");

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border bg-zinc-900/60 p-5 backdrop-blur transition ${
        anyAvailable
          ? "border-emerald-400/40 shadow-[0_0_40px_-12px] shadow-emerald-400/50"
          : "border-zinc-800 hover:border-zinc-700"
      } ${watched ? "" : "opacity-55"}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-white">Apple {store.name}</h3>
          <p className="mt-0.5 truncate text-sm text-zinc-400">
            {store.address ? `${store.address} · ` : ""}
            {store.city}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300">
          {store.distance}
        </span>
      </header>

      <ul className="mt-4 space-y-2">
        {store.parts.map((part) => {
          const s = STATUS_STYLES[part.status];
          return (
            <li key={part.partNumber} className="rounded-xl bg-zinc-950/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-zinc-100">
                  {variantLabel(part.partNumber, part.title)}
                </p>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${s.pill}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{part.quote || part.partNumber}</p>
            </li>
          );
        })}
      </ul>

      <footer className="mt-4 flex items-center justify-between gap-2 text-sm">
        <label className="flex min-w-0 cursor-pointer select-none items-center gap-2 text-zinc-400">
          <input
            type="checkbox"
            checked={watched}
            onChange={onToggleWatch}
            className="h-4 w-4 accent-sky-400"
          />
          Alerter pour ce magasin
        </label>
        {store.url && (
          <a
            href={store.url}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap text-sky-400 transition hover:text-sky-300"
          >
            Fiche magasin ↗
          </a>
        )}
      </footer>
    </article>
  );
}
