// Enterprise fork (CUinspace233/multica): Access tab.
//
// Two-column editor for the runtime-mutable signup allowlist. Emails on
// the left, domains on the right. Each column has its own add input and
// chip list; both invalidate the same query so a single refetch re-renders
// the status strip's counts too.
//
// Validation:
//   - emails:    zod-style regex (RFC-lite; backend enforces mail.ParseAddress)
//   - domains:   acme.com / @acme.com (leading @ stripped server-side)
// On Remove of the LAST entry we show an AlertDialog explaining the
// lockout semantics — except for existing accounts (which always remain
// able to log in per checkSignupAllowed).
"use client";

import * as React from "react";
import { Mail, Globe, Plus, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@multica/ui/components/ui/card";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Input } from "@multica/ui/components/ui/input";
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
import { useT } from "@multica/views/i18n";
import {
  addAllowlistEntry,
  listAllowlist,
  removeAllowlistEntry,
  type AdminAllowlistEntry,
  type AllowlistKind,
} from "@/lib/api/admin";

const ALLOWLIST_QUERY_KEY = ["admin", "allowlist"] as const;

// Frontend regex mirrors server isValidDomain. If either side changes,
// keep them in sync — the server is the gate, the client is the hint.
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccessTab() {
  const { t } = useT("admin");
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ALLOWLIST_QUERY_KEY,
    queryFn: () => listAllowlist(),
  });

  const addMutation = useMutation({
    mutationFn: ({ kind, value }: { kind: AllowlistKind; value: string }) =>
      addAllowlistEntry(kind, value),
    onSuccess: (_, vars) => {
      toast.success(
        vars.kind === "email"
          ? t(($) => $.access.toast_added_email)
          : t(($) => $.access.toast_added_domain)
      );
      qc.invalidateQueries({ queryKey: ALLOWLIST_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["admin", "instance"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t(($) => $.access.toast_failed)),
  });

  const removeMutation = useMutation({
    mutationFn: ({ kind, value }: { kind: AllowlistKind; value: string }) =>
      removeAllowlistEntry(kind, value),
    onSuccess: () => {
      toast.success(t(($) => $.access.toast_removed));
      qc.invalidateQueries({ queryKey: ALLOWLIST_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["admin", "instance"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t(($) => $.access.toast_failed)),
  });

  // Lockout confirm: removing the last entry of either kind pops a
  // confirmation. Existing users still pass through (per
  // checkSignupAllowed's isNewUser short-circuit) but new signups would
  // be rejected until something is added back.
  const [pendingLockout, setPendingLockout] = React.useState<{
    kind: AllowlistKind;
    value: string;
  } | null>(null);

  const requestRemove = (kind: AllowlistKind, value: string) => {
    const entries = query.data?.entries ?? [];
    const remainingOfKind = entries.filter((e) => e.kind === kind).length;
    if (entries.length === 1 && remainingOfKind === 1) {
      setPendingLockout({ kind, value });
      return;
    }
    removeMutation.mutate({ kind, value });
  };

  const emails = (query.data?.entries ?? []).filter((e) => e.kind === "email");
  const domains = (query.data?.entries ?? []).filter((e) => e.kind === "domain");

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t(($) => $.tabs.access)}</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AllowlistColumn
          kind="email"
          entries={emails}
          isLoading={query.isLoading}
          onAdd={(value) => addMutation.mutate({ kind: "email", value })}
          onRemove={(value) => requestRemove("email", value)}
          addPending={addMutation.isPending}
          removePending={removeMutation.isPending}
          labels={{
            title: t(($) => $.access.emails_title),
            desc: t(($) => $.access.emails_desc),
            placeholder: t(($) => $.access.email_placeholder),
            addButton: t(($) => $.access.add_email),
            empty: t(($) => $.access.no_emails),
            invalid: t(($) => $.access.invalid_email),
          }}
        />
        <AllowlistColumn
          kind="domain"
          entries={domains}
          isLoading={query.isLoading}
          onAdd={(value) => addMutation.mutate({ kind: "domain", value })}
          onRemove={(value) => requestRemove("domain", value)}
          addPending={addMutation.isPending}
          removePending={removeMutation.isPending}
          labels={{
            title: t(($) => $.access.domains_title),
            desc: t(($) => $.access.domains_desc),
            placeholder: t(($) => $.access.domain_placeholder),
            addButton: t(($) => $.access.add_domain),
            empty: t(($) => $.access.no_domains),
            invalid: t(($) => $.access.invalid_domain),
          }}
        />
      </div>

      <AlertDialog
        open={!!pendingLockout}
        onOpenChange={(v) => {
          if (!v) setPendingLockout(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.access.lockout_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.access.lockout_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.users.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingLockout) return;
                removeMutation.mutate(pendingLockout);
                setPendingLockout(null);
              }}
            >
              {t(($) => $.access.lockout_confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface AllowlistColumnLabels {
  title: string;
  desc: string;
  placeholder: string;
  addButton: string;
  empty: string;
  invalid: string;
}

interface AllowlistColumnProps {
  kind: AllowlistKind;
  entries: AdminAllowlistEntry[];
  isLoading: boolean;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  addPending: boolean;
  removePending: boolean;
  labels: AllowlistColumnLabels;
}

function AllowlistColumn({
  kind,
  entries,
  isLoading,
  onAdd,
  onRemove,
  addPending,
  removePending,
  labels,
}: AllowlistColumnProps) {
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState<string | null>(null);

  function tryAdd() {
    const value = draft.trim();
    if (!value) return;
    const isEmail = kind === "email";
    const valid = isEmail ? EMAIL_RE.test(value) : DOMAIN_RE.test(value.replace(/^@/, ""));
    if (!valid) {
      setDraftError(labels.invalid);
      return;
    }
    setDraftError(null);
    setDraft("");
    onAdd(isEmail ? value.toLowerCase() : value.toLowerCase().replace(/^@/, ""));
  }

  const Icon = kind === "email" ? Mail : Globe;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {labels.title}
        </CardTitle>
        <CardDescription>{labels.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              type="text"
              value={draft}
              placeholder={labels.placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                if (draftError) setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") tryAdd();
              }}
              aria-invalid={!!draftError}
            />
            {draftError && (
              <p className="text-xs text-destructive mt-1">{draftError}</p>
            )}
          </div>
          <Button onClick={tryAdd} disabled={addPending || !draft.trim()}>
            <Plus className="h-3.5 w-3.5" />
            {labels.addButton}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        ) : entries.length === 0 ? (
          <Empty className="border-0 p-4 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon />
              </EmptyMedia>
              <EmptyTitle className="text-sm">{labels.empty}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {entries.map((e) => (
              <Badge
                key={`${e.kind}:${e.value}`}
                variant="secondary"
                className="font-mono text-xs gap-1 pr-1"
              >
                {kind === "domain" ? "@" : ""}
                {e.value}
                <button
                  type="button"
                  onClick={() => onRemove(e.value)}
                  disabled={removePending}
                  className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-sm hover:bg-foreground/10 disabled:opacity-50"
                  aria-label={`Remove ${e.value}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}