// Enterprise fork (CUinspace233/multica): Users tab.
//
// Lists every user in the instance with their role + status. Per-row
// actions (promote/demote admin, disable/enable, copy ID) live in a
// DropdownMenu — same pattern as settings → members → MemberRow.
//
// Search is debounced 300ms before hitting /api/admin/users?q= so we don't
// hammer the backend on every keystroke. The query is enabled even at q="""
// so the initial fetch happens once and the rows stay mounted across
// tab switches (React Query cache).
"use client";

import * as React from "react";
import {
  Users,
  Shield,
  User,
  MoreHorizontal,
  ShieldCheck,
  ShieldOff,
  UserX,
  UserCheck,
  Copy,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
} from "@multica/ui/components/ui/card";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@multica/ui/components/ui/input-group";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@multica/ui/components/ui/empty";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@multica/ui/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@multica/ui/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@multica/ui/components/ui/avatar";
import { useT } from "@multica/views/i18n";
import { useAuthStore } from "@multica/core/auth";
import {
  listUsers,
  setUserAdmin,
  setUserDisabled,
  type AdminUser,
} from "@/lib/api/admin";

const ADMIN_QUERY_KEY = ["admin", "users"] as const;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function UsersTab() {
  const { t } = useT("admin");
  const currentUser = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const usersQuery = useQuery({
    queryKey: [...ADMIN_QUERY_KEY, debouncedSearch],
    queryFn: () =>
      listUsers({
        q: debouncedSearch || undefined,
        limit: 200,
      }),
  });

  // Each mutation invalidates the list so the row re-renders. We could
  // optimistically patch the cache (TanStack Query supports setQueryData)
  // but the optimistic state can drift on errors and the table is small,
  // so a refetch is the simpler trade-off.
  const promoteMutation = useMutation({
    mutationFn: ({ id, isAdmin }: { id: string; isAdmin: boolean }) =>
      setUserAdmin(id, isAdmin),
    onSuccess: (_, vars) => {
      toast.success(
        vars.isAdmin
          ? t(($) => $.users.toast_promoted)
          : t(($) => $.users.toast_demoted)
      );
      qc.invalidateQueries({ queryKey: ADMIN_QUERY_KEY });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t(($) => $.users.toast_failed)),
  });

  const disableMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      setUserDisabled(id, disabled),
    onSuccess: (_, vars) => {
      toast.success(
        vars.disabled
          ? t(($) => $.users.toast_disabled)
          : t(($) => $.users.toast_enabled)
      );
      qc.invalidateQueries({ queryKey: ADMIN_QUERY_KEY });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t(($) => $.users.toast_failed)),
  });

  // Self-disable guard: showing a confirm dialog before letting an admin
  // disable themselves. Hard-blocking is worse UX (lockout via typo) than
  // a confirm + clear copy.
  const [pendingSelfDisable, setPendingSelfDisable] =
    React.useState<AdminUser | null>(null);

  const users = usersQuery.data?.users ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {t(($) => $.tabs.users)}
          {usersQuery.data && (
            <span className="ml-2 text-muted-foreground font-normal">
              {usersQuery.data.total}
            </span>
          )}
        </h2>
      </div>

      <InputGroup className="sm:max-w-xs">
        <InputGroupAddon align="inline-start">
          <Search className="h-3.5 w-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={t(($) => $.users.search_placeholder)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>

      {usersQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : users.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>{t(($) => $.users.no_users)}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {users.map((u, i) => (
            <div
              key={u.id}
              className={
                i > 0 ? "border-t border-border/50" : ""
              }
            >
              <UserRow
                user={u}
                isSelf={currentUser?.id === u.id}
                onPromote={() =>
                  promoteMutation.mutate({ id: u.id, isAdmin: true })
                }
                onDemote={() =>
                  promoteMutation.mutate({ id: u.id, isAdmin: false })
                }
                onDisable={() => {
                  if (currentUser?.id === u.id) {
                    setPendingSelfDisable(u);
                    return;
                  }
                  disableMutation.mutate({ id: u.id, disabled: true });
                }}
                onEnable={() =>
                  disableMutation.mutate({ id: u.id, disabled: false })
                }
                labels={{
                  promote: t(($) => $.users.promote),
                  demote: t(($) => $.users.demote),
                  disable: t(($) => $.users.disable),
                  enable: t(($) => $.users.enable),
                  copyId: t(($) => $.users.copy_id),
                  copyIdDone: t(($) => $.users.copy_id_done),
                  moreActionsAria: t(($) => $.users.more_actions_aria),
                  youBadge: t(($) => $.users.you_badge),
                  roleSuperuser: t(($) => $.users.role_superuser),
                  roleMember: t(($) => $.users.role_member),
                  statusDisabled: t(($) => $.users.status_disabled),
                }}
              />
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!pendingSelfDisable}
        onOpenChange={(v) => {
          if (!v) setPendingSelfDisable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.users.cannot_disable_self_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.users.cannot_disable_self_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.users.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingSelfDisable) return;
                disableMutation.mutate({
                  id: pendingSelfDisable.id,
                  disabled: true,
                });
                setPendingSelfDisable(null);
              }}
            >
              {t(($) => $.users.confirm_disable_self)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface UserRowProps {
  user: AdminUser;
  isSelf: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onDisable: () => void;
  onEnable: () => void;
  labels: {
    promote: string;
    demote: string;
    disable: string;
    enable: string;
    copyId: string;
    copyIdDone: string;
    moreActionsAria: string;
    youBadge: string;
    roleSuperuser: string;
    roleMember: string;
    statusDisabled: string;
  };
}

function UserRow({
  user,
  isSelf,
  onPromote,
  onDemote,
  onDisable,
  onEnable,
  labels,
}: UserRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar className="h-8 w-8 shrink-0">
        {user.avatar_url && (
          <AvatarImage src={user.avatar_url} alt={user.name} />
        )}
        <AvatarFallback className="text-xs">
          {user.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate flex items-center gap-2">
          {user.name}
          {isSelf && (
            <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wide">
              {labels.youBadge}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={labels.moreActionsAria}
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto">
          {user.is_admin ? (
            <DropdownMenuItem onClick={onDemote}>
              <ShieldOff className="h-3.5 w-3.5" />
              {labels.demote}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onPromote}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {labels.promote}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard.writeText(user.id).then(() => {
                toast.success(labels.copyIdDone);
              });
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {labels.copyId}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.disabled ? (
            <DropdownMenuItem onClick={onEnable}>
              <UserCheck className="h-3.5 w-3.5" />
              {labels.enable}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={onDisable}>
              <UserX className="h-3.5 w-3.5" />
              {labels.disable}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {user.is_admin && (
        <Badge variant="secondary">
          <Shield className="h-3 w-3" />
          {labels.roleSuperuser}
        </Badge>
      )}
      {user.disabled ? (
        <Badge variant="destructive">{labels.statusDisabled}</Badge>
      ) : (
        <Badge variant="outline">
          <User className="h-3 w-3" />
          {labels.roleMember}
        </Badge>
      )}
    </div>
  );
}