// Enterprise fork (CUinspace233/multica): main admin dashboard.
//
// Single-page Tabs shell. Four Tabs: Users / Workspaces / Runtimes / Access.
// The settings page (apps/web/packages/views/settings/components/settings-page.tsx)
// is the structural model — vertical Tabs on the left, content pane on the
// right. Layout: status strip on top (server-rendered), then this client
// component for the live data.
//
// Why a single client component instead of 4 separate pages: the operator
// almost always switches between Users and Access in the same session, and
// keeping the Tabs mounted preserves the per-Tab query cache so re-visits
// are instant. Sub-tabs live in /admin/admin/tabs/* so each is small enough
// to read in isolation.
"use client";

import * as React from "react";
import { Users, FolderKanban, Monitor, ShieldCheck } from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@multica/ui/components/ui/tabs";
import { useT } from "@multica/views/i18n";
import { UsersTab } from "./tabs/users-tab";
import { WorkspacesTab } from "./tabs/workspaces-tab";
import { RuntimesTab } from "./tabs/runtimes-tab";
import { AccessTab } from "./tabs/access-tab";

type AdminTabKey = "users" | "workspaces" | "runtimes" | "access";

export function AdminDashboard() {
  const { t } = useT("admin");
  const [active, setActive] = React.useState<AdminTabKey>("users");

  return (
    <Tabs
      value={active}
      onValueChange={(v) => setActive(v as AdminTabKey)}
      orientation="vertical"
      className="flex-1 min-h-0 gap-0 flex flex-col md:flex-row md:overflow-hidden overflow-y-auto [&_[data-slot=button]]:cursor-pointer [&_[data-slot=tabs-trigger]]:cursor-pointer [&_[data-slot=dropdown-menu-item]]:cursor-pointer [&_[data-slot=alert-dialog-action]]:cursor-pointer [&_[data-slot=alert-dialog-cancel]]:cursor-pointer"
    >
      {/* Left nav. Mirrors settings-page.tsx with two logical groups:
          Identity (users/workspaces/runtimes) + Access. Single instance-wide
          superuser role, so we don't need a "My Account" group like the
          user-facing settings page does. */}
      <div className="shrink-0 md:w-52 border-b md:border-b-0 md:border-r md:overflow-y-auto p-3 md:p-4">
        <h1 className="hidden md:block text-sm font-semibold mb-1 px-2">{t(($) => $.page_title)}</h1>
        <p className="hidden md:block text-xs text-muted-foreground mb-4 px-2">
          {t(($) => $.page_subtitle)}
        </p>
        <TabsList variant="line" className="flex-col items-stretch w-full">
          <span className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground truncate">
            {t(($) => $.groups.identity)}
          </span>
          <TabsTrigger value="users">
            <Users className="h-4 w-4" />
            {t(($) => $.tabs.users)}
          </TabsTrigger>
          <TabsTrigger value="workspaces">
            <FolderKanban className="h-4 w-4" />
            {t(($) => $.tabs.workspaces)}
          </TabsTrigger>
          <TabsTrigger value="runtimes">
            <Monitor className="h-4 w-4" />
            {t(($) => $.tabs.runtimes)}
          </TabsTrigger>
          <span className="px-2 pb-1 pt-4 text-xs font-medium text-muted-foreground truncate">
            {t(($) => $.groups.access)}
          </span>
          <TabsTrigger value="access">
            <ShieldCheck className="h-4 w-4" />
            {t(($) => $.tabs.access)}
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Right content. Each Tab is independently query-scoped so switching
          tabs doesn't refetch the others' data. max-w-3xl matches
          settings-page.tsx so cards / forms render at the same width. */}
      <div className="flex-1 min-w-0 md:overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto p-4 md:p-6">
          <TabsContent value="users" className="mt-0">
            <UsersTab />
          </TabsContent>
          <TabsContent value="workspaces" className="mt-0">
            <WorkspacesTab />
          </TabsContent>
          <TabsContent value="runtimes" className="mt-0">
            <RuntimesTab />
          </TabsContent>
          <TabsContent value="access" className="mt-0">
            <AccessTab />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}