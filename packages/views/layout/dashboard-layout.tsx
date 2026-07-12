"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { ModalRegistry } from "../modals/registry";
import { SourceBackfillModal } from "../onboarding";
import { AppSidebar } from "./app-sidebar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspacePresencePrefetch } from "./workspace-presence-prefetch";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Rendered inside SidebarInset (e.g. ChatWindow, ChatFab — absolute-positioned overlays) */
  extra?: ReactNode;
  /** Rendered inside sidebar header as a search trigger */
  searchSlot?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
}

export function DashboardLayout({
  children,
  extra,
  searchSlot,
  loadingIndicator,
}: DashboardLayoutProps) {
  return (
    // SidebarProvider is mounted OUTSIDE DashboardGuard so the chrome
    // (and the mobile hamburger trigger inside page headers) survives any
    // transient `!workspace` window — e.g. workspace-list cache eviction
    // during a long-lived session. The guard now only gates the inner
    // content area; its fallback renders as an overlay inside SidebarInset
    // so the sidebar skeleton stays visible to the right user.
    <SidebarProvider className="h-svh bg-app-shell">
      <WorkspacePresencePrefetch />
      <AppSidebar searchSlot={searchSlot} />
      <SidebarInset className="relative overflow-hidden">
        <NavigationProgress />
        <DashboardGuard
          loadingFallback={
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-background">
              {loadingIndicator}
            </div>
          }
        >
          {children}
          <ModalRegistry />
          <SourceBackfillModal />
          {extra}
        </DashboardGuard>
      </SidebarInset>
    </SidebarProvider>
  );
}
