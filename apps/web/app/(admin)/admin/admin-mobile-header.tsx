"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { useT } from "@multica/views/i18n";

// /admin has no sidebar in this fork (it's outside the dashboard shell), so
// the only "back to workspaces" affordance on mobile is the browser history
// button — which doesn't survive tab-switching or deep-link reloads. This
// thin header gives admins a direct link back to their last workspace via
// the proxy's "/" -> "/{lastSlug}/issues" redirect. Renders at h-12 on all
// widths; the back button is hidden at md+ (desktop operators have plenty
// of workspace chrome once they're back).
export function AdminMobileHeader() {
  const isMobile = useIsMobile();
  const { t } = useT("admin");
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      {isMobile && (
        <Link
          href="/"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t(($) => $.back_to_workspaces)}
        </Link>
      )}
      <h1 className="text-sm font-medium">{t(($) => $.page_title)}</h1>
    </div>
  );
}
