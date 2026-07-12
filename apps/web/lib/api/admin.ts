// Enterprise fork (CUinspace233/multica): typed wrappers for /api/admin/*.
//
// All admin endpoints go through the shared @multica/core/api singleton so
// cookies (multica_auth + multica_csrf) and the X-Workspace-Slug header are
// forwarded automatically. The CSRF header is required by the backend for
// state-changing requests on cookie-authenticated routes — the ApiClient
// adds it for us (see packages/core/api/client.ts).
"use client";

import { api } from "@multica/core/api";

// =============================================================================
// Read-side shapes (mirror the Go adminUserResponse / adminWorkspaceResponse /
// adminRuntimeResponse in server/internal/handler/admin.go).
// =============================================================================

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  is_admin: boolean;
  disabled: boolean;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  member_count: number;
  issue_prefix: string;
  issue_counter: number;
  created_at: string;
  updated_at: string;
}

export interface AdminRuntime {
  id: string;
  workspace_id: string;
  owner_id: string | null;
  owner_email: string | null;
  daemon_id: string;
  name: string;
  provider: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

export type AllowlistKind = "email" | "domain";

export interface AdminAllowlistEntry {
  kind: AllowlistKind;
  value: string;
  created_at: string;
  created_by?: string | null;
}

export interface AdminInstanceStats {
  instance_name: string;
  uptime_seconds: number;
  signup_open: boolean;
  allowlist_emails_count: number;
  allowlist_domains_count: number;
  runtimes_online: number;
  runtimes_total: number;
  last_admin_action_at: string | null;
}

// =============================================================================
// API surface — typed wrappers around the singleton.
// =============================================================================

/**
 * Fetch the per-instance stats used by the admin status strip. Called once
 * at mount; TanStack Query caches the result so tab switches don't refetch.
 */
export function getInstanceStats() {
  return api.fetch<AdminInstanceStats>("/api/admin/instance");
}

/** List every user in the instance. Server caps at 200. */
export function listUsers(opts?: { q?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return api.fetch<{ users: AdminUser[]; total: number }>(
    qs ? `/api/admin/users?${qs}` : "/api/admin/users"
  );
}

/** Flip a user's is_admin flag. Used to promote/demote superusers. */
export function setUserAdmin(userId: string, isAdmin: boolean) {
  return api.fetch<AdminUser>(`/api/admin/users/${userId}/admin`, {
    method: "POST",
    body: JSON.stringify({ is_admin: isAdmin }),
  });
}

/** Toggle a user's disabled_at. true => now(); false => NULL. */
export function setUserDisabled(userId: string, disabled: boolean) {
  return api.fetch<AdminUser>(`/api/admin/users/${userId}/disabled`, {
    method: "POST",
    body: JSON.stringify({ disabled }),
  });
}

/** List every workspace in the instance. */
export function listWorkspaces(opts?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return api.fetch<{ workspaces: AdminWorkspace[]; total: number }>(
    qs ? `/api/admin/workspaces?${qs}` : "/api/admin/workspaces"
  );
}

/** List every daemon runtime across the instance. */
export function listRuntimes(opts?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return api.fetch<{ runtimes: AdminRuntime[]; total: number }>(
    qs ? `/api/admin/runtimes?${qs}` : "/api/admin/runtimes"
  );
}

/** List allowlist entries. */
export function listAllowlist() {
  return api.fetch<{ entries: AdminAllowlistEntry[]; total: number }>(
    "/api/admin/allowlist"
  );
}

/**
 * Add an entry to the runtime allowlist. Validation lives on the server
 * (mail.ParseAddress for emails, isValidDomain for domains) so a stale
 * client cannot smuggle malformed entries past the gate.
 */
export function addAllowlistEntry(kind: AllowlistKind, value: string) {
  return api.fetch<AdminAllowlistEntry>("/api/admin/allowlist", {
    method: "POST",
    body: JSON.stringify({ kind, value }),
  });
}

/** Remove an entry. The cache mirrors immediately so signup attempts see it. */
export function removeAllowlistEntry(kind: AllowlistKind, value: string) {
  return api.fetch<{ kind: AllowlistKind; value: string }>(
    "/api/admin/allowlist",
    {
      method: "DELETE",
      body: JSON.stringify({ kind, value }),
    }
  );
}