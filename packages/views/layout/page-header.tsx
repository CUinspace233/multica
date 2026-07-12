"use client";

import { cn } from "@multica/ui/lib/utils";
import { SidebarTrigger } from "@multica/ui/components/ui/sidebar";

/**
 * Always render the mobile hamburger. Visibility is gated purely by the
 * caller's `md:hidden` className — `SidebarTrigger` internally uses a safe
 * context hook, so even if the provider tree is briefly missing the button
 * stays rendered and the click becomes a no-op rather than crashing.
 */
function MobileSidebarTrigger() {
  return <SidebarTrigger className="mr-2 md:hidden" />;
}

interface PageHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function PageHeader({ children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex h-12 shrink-0 items-center border-b px-4", className)}>
      <MobileSidebarTrigger />
      {children}
    </header>
  );
}
