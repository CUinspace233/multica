// Enterprise fork (CUinspace233/multica): Runtimes tab.
//
// Read-only list of every daemon runtime across the instance. Each row
// shows the daemon name, provider (claude/codex/...), online status dot,
// owner email, and last heartbeat. Online/offline is read off the
// `status` field the daemon itself writes during heartbeat (see
// server/pkg/agent-runtime / multica daemon).
"use client";

import * as React from "react";
import {
  Monitor,
  Search,
  CircleDot,
  CircleDashed,
  Cpu,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { Badge } from "@multica/ui/components/ui/badge";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@multica/ui/components/ui/empty";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@multica/ui/components/ui/input-group";
import { useT } from "@multica/views/i18n";
import { listRuntimes, type AdminRuntime } from "@/lib/api/admin";

const RUNTIMES_QUERY_KEY = ["admin", "runtimes"] as const;

export function RuntimesTab() {
  const { t } = useT("admin");
  const [search, setSearch] = React.useState("");

  const query = useQuery({
    queryKey: RUNTIMES_QUERY_KEY,
    queryFn: () => listRuntimes({ limit: 200 }),
  });

  const filtered = React.useMemo(() => {
    const all = query.data?.runtimes ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        (r.owner_email ?? "").toLowerCase().includes(term) ||
        r.provider.toLowerCase().includes(term)
    );
  }, [query.data, search]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {t(($) => $.tabs.runtimes)}
          {query.data && (
            <span className="ml-2 text-muted-foreground font-normal">
              {query.data.total}
            </span>
          )}
        </h2>
      </div>

      <InputGroup className="sm:max-w-xs">
        <InputGroupAddon align="inline-start">
          <Search className="h-3.5 w-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={t(($) => $.runtimes.search_placeholder)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>

      {query.isLoading ? (
        <Card>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Monitor />
            </EmptyMedia>
            <EmptyTitle>{t(($) => $.runtimes.no_runtimes)}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {filtered.map((r, i) => (
            <RuntimeRow
              key={r.id}
              runtime={r}
              divider={i > 0}
              onlineLabel={t(($) => $.runtimes.status_online)}
              offlineLabel={t(($) => $.runtimes.status_offline)}
              providerLabel={t(($) => $.runtimes.provider)}
              lastSeenLabel={t(($) => $.runtimes.last_seen)}
              neverLabel={t(($) => $.runtimes.last_seen_never)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface RuntimeRowProps {
  runtime: AdminRuntime;
  divider: boolean;
  onlineLabel: string;
  offlineLabel: string;
  providerLabel: string;
  lastSeenLabel: string;
  neverLabel: string;
}

function RuntimeRow({
  runtime: r,
  divider,
  onlineLabel,
  offlineLabel,
  providerLabel,
  lastSeenLabel,
  neverLabel,
}: RuntimeRowProps) {
  const isOnline = r.status === "online";
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${divider ? "border-t border-border/50" : ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
        <Cpu className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{r.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {r.owner_email || "—"}
        </div>
      </div>
      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
        {r.provider}
      </Badge>
      <div className="flex items-center gap-1.5 text-xs shrink-0 min-w-24">
        {isOnline ? (
          <CircleDot className="h-3 w-3 text-success" />
        ) : (
          <CircleDashed className="h-3 w-3 text-muted-foreground/60" />
        )}
        <span className={isOnline ? "text-success" : "text-muted-foreground"}>
          {isOnline ? onlineLabel : offlineLabel}
        </span>
      </div>
      <div className="text-xs text-muted-foreground shrink-0 min-w-32 text-right">
        {r.last_seen_at
          ? new Date(r.last_seen_at).toLocaleString()
          : neverLabel}
      </div>
    </div>
  );
}