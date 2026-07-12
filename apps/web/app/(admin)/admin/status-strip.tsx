// Enterprise fork (CUinspace233/multica): thin status strip rendered above
// the admin tabs. Surfaces instance identity + the numbers an operator
// scans for ("is the system healthy?") before they touch anything.
//
// Server component — fetched once on mount, never needs to be live. Numbers
// read like `instance · uptime · signup · allowlist · runtimes · last
// admin action`. `ml-auto` pushes the last item right so the strip reads
// as a control-panel header instead of a footer.
import { cookies } from "next/headers";
import type { AdminInstanceStats } from "@/lib/api/admin";

async function fetchStats(): Promise<AdminInstanceStats | null> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const res = await fetch(
      `${process.env.REMOTE_API_URL || "http://backend:8080"}/api/admin/instance`,
      { headers: { cookie: cookieHeader }, cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as AdminInstanceStats;
  } catch {
    return null;
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export async function StatusStrip() {
  const stats = await fetchStats();
  // Failure mode: don't block the whole admin page — render a minimal
  // strip with a single "instance: unreachable" entry so the operator
  // knows something is wrong without a separate empty state.
  const instance = stats?.instance_name || "instance";

  return (
    <div className="border-b h-auto md:h-9 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-nowrap md:gap-6 px-4 text-xs text-muted-foreground">
      <span className="font-mono">
        <span className="text-muted-foreground/70">instance</span>{" "}
        <span className="text-foreground">{instance}</span>
      </span>
      <span className="font-mono">
        <span className="text-muted-foreground/70">uptime</span>{" "}
        <span className="text-foreground">
          {stats ? formatUptime(stats.uptime_seconds) : "—"}
        </span>
      </span>
      <span className="font-mono">
        <span className="text-muted-foreground/70">signup</span>{" "}
        <span
          className={
            stats?.signup_open ? "text-success" : "text-muted-foreground"
          }
        >
          {stats?.signup_open ? "open" : "closed"}
        </span>
      </span>
      <span className="font-mono">
        <span className="text-muted-foreground/70">allowlist</span>{" "}
        <span className="text-foreground">
          {stats
            ? `${stats.allowlist_emails_count} emails · ${stats.allowlist_domains_count} domains`
            : "—"}
        </span>
      </span>
      <span className="font-mono">
        <span className="text-muted-foreground/70">runtimes</span>{" "}
        <span className="text-foreground">
          {stats
            ? `${stats.runtimes_online} online / ${stats.runtimes_total} total`
            : "—"}
        </span>
      </span>
      <span className="ml-auto font-mono">
        <span className="text-muted-foreground/70">last admin action</span>{" "}
        <span className="text-muted-foreground">never</span>
      </span>
    </div>
  );
}