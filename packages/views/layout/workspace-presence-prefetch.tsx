"use client";

import { useCurrentWorkspace } from "@multica/core/paths";
import { useWorkspacePresencePrefetch } from "@multica/core/agents";

// Mount inside the dashboard shell (DashboardLayout on web,
// WorkspaceRouteLayout on desktop). Tolerates a transiently-null workspace
// (e.g. workspace list cache eviction during a long-lived session) by
// skipping the prefetch; the queries will simply re-enable once the
// workspace resolves again.
export function WorkspacePresencePrefetch() {
  const workspace = useCurrentWorkspace();
  useWorkspacePresencePrefetch(workspace?.id);
  return null;
}
