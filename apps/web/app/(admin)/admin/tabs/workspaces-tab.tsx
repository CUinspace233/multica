// Enterprise fork (CUinspace233/multica): Workspaces tab.
//
// Read-only list of every workspace in the instance. Each row shows name,
// slug (mono), member count, and issue counter. Search filters in the
// client (not the server) because the workspace list is bounded by the
// instance's total workspace count — usually tens, not thousands.
"use client";

import * as React from "react";
import { FolderKanban, Search, Hash, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@multica/ui/components/ui/card";
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
import { listWorkspaces, type AdminWorkspace } from "@/lib/api/admin";

const WORKSPACES_QUERY_KEY = ["admin", "workspaces"] as const;

export function WorkspacesTab() {
  const { t } = useT("admin");
  const [search, setSearch] = React.useState("");

  const query = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => listWorkspaces({ limit: 200 }),
  });

  const filtered = React.useMemo(() => {
    const all = query.data?.workspaces ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (w) =>
        w.name.toLowerCase().includes(term) ||
        w.slug.toLowerCase().includes(term)
    );
  }, [query.data, search]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <FolderKanban className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {t(($) => $.tabs.workspaces)}
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
          placeholder={t(($) => $.workspaces.search_placeholder)}
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
              </div>
            ))}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban />
            </EmptyMedia>
            <EmptyTitle>{t(($) => $.workspaces.no_workspaces)}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {filtered.map((w, i) => (
            <WorkspaceRow
              key={w.id}
              workspace={w}
              divider={i > 0}
              membersLabel={(c) =>
                t(($) => $.workspaces.members, { count: c })
              }
              issuesLabel={(c) =>
                t(($) => $.workspaces.issues, { count: c })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface WorkspaceRowProps {
  workspace: AdminWorkspace;
  divider: boolean;
  membersLabel: (count: number) => string;
  issuesLabel: (count: number) => string;
}

function WorkspaceRow({
  workspace: w,
  divider,
  membersLabel,
  issuesLabel,
}: WorkspaceRowProps) {
  // Fallback for descriptions that haven't been set: single line in
  // muted-foreground instead of an empty space.
  const description = w.description?.trim();
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${divider ? "border-t border-border/50" : ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
        {w.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{w.name}</div>
        {description ? (
          <div className="text-xs text-muted-foreground truncate">
            {description}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground truncate font-mono">
            {w.slug}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
        <Users className="h-3 w-3" />
        <span>{membersLabel(w.member_count)}</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 min-w-20 justify-end">
        <Hash className="h-3 w-3" />
        <span>
          {w.issue_prefix}-{w.issue_counter}
        </span>
      </div>
    </div>
  );
}