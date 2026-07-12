// Package handler — enterprise fork (CUinspace233/multica): global admin
// endpoints. Multica upstream only has per-workspace admin roles; this
// file adds /api/admin/* surface for a single global superuser (the
// self-host operator) to manage users, workspaces, daemon runtimes, and
// the runtime-mutable signup allowlist across the entire instance.
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// RequireSuperuser is the middleware mounted on the /api/admin/* route
// group. It MUST be ordered AFTER middleware.Auth: it reads the JWT
// claims that Auth stashed on the request context and asserts the
// is_admin claim is true. Single HMAC verify (in Auth); no parallel
// auth path here.
//
// Disabled users are already rejected by middleware.Auth before they
// reach this function, so RequireSuperuser only needs to gate on the
// is_admin claim.
func RequireSuperuser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !middleware.IsAdminFromContext(r.Context()) {
			writeError(w, http.StatusForbidden, "superuser required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// =============================================================================
// HTTP handlers
// =============================================================================

// AdminUsersHandler implements /api/admin/users endpoints. *db.Queries
// is goroutine-safe so a single instance handles every request.
type AdminUsersHandler struct {
	Queries *db.Queries
}

// adminUserResponse is the JSON shape sent to the admin UI.
type adminUserResponse struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Email      string  `json:"email"`
	AvatarURL  *string `json:"avatar_url"`
	IsAdmin    bool    `json:"is_admin"`
	Disabled   bool    `json:"disabled"`
	DisabledAt *string `json:"disabled_at,omitempty"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

func toAdminUser(u db.User) adminUserResponse {
	return adminUserResponse{
		ID:         util.UUIDToString(u.ID),
		Name:       u.Name,
		Email:      u.Email,
		AvatarURL:  textToPtr(u.AvatarUrl),
		IsAdmin:    u.IsAdmin,
		Disabled:   u.DisabledAt.Valid,
		DisabledAt: timestampToPtr(u.DisabledAt),
		CreatedAt:  timestampToString(u.CreatedAt),
		UpdatedAt:  timestampToString(u.UpdatedAt),
	}
}

// List returns every user in the database paginated. Query params:
//
//	?limit=N   (default 50, capped at 200)
//	?offset=N  (default 0)
//	?q=term    (optional, case-insensitive name/email substring)
func (h *AdminUsersHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, offset := adminPagination(r, 50, 200)

	if q != "" {
		users, err := h.Queries.AdminSearchUsers(r.Context(), db.AdminSearchUsersParams{
			Column1: pgtype.Text{String: q, Valid: true},
			Limit:   int32(limit),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "search failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"users": mapUsersToAdmin(users),
			"total": int64(len(users)),
		})
		return
	}

	users, err := h.Queries.ListAllUsersAdmin(r.Context(), db.ListAllUsersAdminParams{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list users failed")
		return
	}
	count, err := h.Queries.CountAllUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "count users failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": mapUsersToAdmin(users),
		"total": count,
	})
}

// Get returns a single user by UUID.
func (h *AdminUsersHandler) Get(w http.ResponseWriter, r *http.Request) {
	uid, err := util.ParseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	u, err := h.Queries.GetUserByIDAdmin(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, toAdminUser(u))
}

// SetAdmin flips a user's is_admin flag.
func (h *AdminUsersHandler) SetAdmin(w http.ResponseWriter, r *http.Request) {
	uid, err := util.ParseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body struct {
		IsAdmin bool `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	u, err := h.Queries.SetUserAdmin(r.Context(), db.SetUserAdminParams{
		ID:      uid,
		IsAdmin: body.IsAdmin,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, toAdminUser(u))
}

// SetDisabled toggles disabled_at (true => now(), false => NULL).
// Note: revoking active PATs is not done here — that's the operator's
// job. Disabling stops new sessions at JWT re-issue time (cookie
// expiry), and middleware.Auth rejects in-flight JWT-cookied requests
// the next time they re-authenticate.
func (h *AdminUsersHandler) SetDisabled(w http.ResponseWriter, r *http.Request) {
	uid, err := util.ParseUUID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body struct {
		Disabled bool `json:"disabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var disabledAt pgtype.Timestamptz
	if body.Disabled {
		disabledAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	} // else disabledAt stays zero-valued (Valid:false → SQL NULL)
	u, err := h.Queries.SetUserDisabled(r.Context(), db.SetUserDisabledParams{
		ID:         uid,
		DisabledAt: disabledAt,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, toAdminUser(u))
}

// =============================================================================
// Workspaces + runtimes
// =============================================================================

type AdminWorkspacesHandler struct {
	Queries *db.Queries
}

type adminWorkspaceResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Description  string `json:"description"`
	MemberCount  int64  `json:"member_count"`
	IssuePrefix  string `json:"issue_prefix"`
	IssueCounter int32  `json:"issue_counter"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func (h *AdminWorkspacesHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := adminPagination(r, 50, 200)
	rows, err := h.Queries.ListAllWorkspacesAdmin(r.Context(), db.ListAllWorkspacesAdminParams{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list workspaces failed")
		return
	}
	total, err := h.Queries.CountAllWorkspaces(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "count workspaces failed")
		return
	}
	out := make([]adminWorkspaceResponse, 0, len(rows))
	for _, w := range rows {
		out = append(out, adminWorkspaceResponse{
			ID:           util.UUIDToString(w.ID),
			Name:         w.Name,
			Slug:         w.Slug,
			Description:  pgtypeTextToString(w.Description),
			MemberCount:  w.MemberCount,
			IssuePrefix:  w.IssuePrefix,
			IssueCounter: w.IssueCounter,
			CreatedAt:    timestampToString(w.CreatedAt),
			UpdatedAt:    timestampToString(w.UpdatedAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": out, "total": total})
}

type AdminRuntimesHandler struct {
	Queries *db.Queries
}

type adminRuntimeResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	OwnerID     *string `json:"owner_id"`
	OwnerEmail  *string `json:"owner_email"`
	DaemonID    string  `json:"daemon_id"`
	Name        string  `json:"name"`
	Provider    string  `json:"provider"`
	Status      string  `json:"status"`
	LastSeenAt  *string `json:"last_seen_at"`
	CreatedAt   string  `json:"created_at"`
}

func (h *AdminRuntimesHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := adminPagination(r, 50, 200)
	rows, err := h.Queries.ListAllRuntimesAdmin(r.Context(), db.ListAllRuntimesAdminParams{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list runtimes failed")
		return
	}
	total, err := h.Queries.CountAllRuntimes(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "count runtimes failed")
		return
	}
	out := make([]adminRuntimeResponse, 0, len(rows))
	for _, rt := range rows {
		var ownerID, ownerEmail *string
		if rt.OwnerID.Valid {
			s := util.UUIDToString(rt.OwnerID)
			ownerID = &s
		}
		if rt.OwnerEmail.Valid && rt.OwnerEmail.String != "" {
			s := rt.OwnerEmail.String
			ownerEmail = &s
		}
		out = append(out, adminRuntimeResponse{
			ID:          util.UUIDToString(rt.ID),
			WorkspaceID: util.UUIDToString(rt.WorkspaceID),
			OwnerID:     ownerID,
			OwnerEmail:  ownerEmail,
			DaemonID:    pgtypeTextToString(rt.DaemonID),
			Name:        rt.Name,
			Provider:    rt.Provider,
			Status:      rt.Status,
			LastSeenAt:  timestampToPtr(rt.LastSeenAt),
			CreatedAt:   timestampToString(rt.CreatedAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"runtimes": out, "total": total})
}

// =============================================================================
// Helpers
// =============================================================================

func adminPagination(r *http.Request, def, max int) (int, int) {
	limit := def
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > max {
		limit = max
	}
	offset := 0
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

func mapUsersToAdmin(users []db.User) []adminUserResponse {
	out := make([]adminUserResponse, 0, len(users))
	for _, u := range users {
		out = append(out, toAdminUser(u))
	}
	return out
}

func pgtypeTextToString(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

// =============================================================================
// Allowlist (runtime-mutable signup gate)
// =============================================================================

// allowlistKind values must match the CHECK constraint in migration 135.
const (
	allowlistKindEmail  = "email"
	allowlistKindDomain = "domain"
)

// AdminAllowlistHandler backs GET /api/admin/allowlist, POST /api/admin/allowlist,
// DELETE /api/admin/allowlist. State lives in the runtime_allowlist table
// (durable) and is mirrored into an in-memory cache (read by the signup gate on
// every /auth/send-code call).
//
// The cache is the hot path: signup is on the unauthenticated /auth/send-code
// route and runs once per email; a Postgres round-trip per attempt would be
// wasteful and would have to be made cache-safe across the cluster anyway. The
// trade-off is that a backend restart sees the env-seeded fallback if the table
// is empty — startup seeding handles the transition.
//
// `loaded` distinguishes "we read the DB and found nothing" from "we haven't
// read the DB yet." checkSignupAllowed only consults the cache when loaded ==
// true, so the env vars remain authoritative until the first time anyone
// visits the Access tab (or the first time the admin handler rewrites the
// table, which forces a load via loadIfNeeded).
type AdminAllowlistHandler struct {
	Queries *db.Queries

	mu      sync.RWMutex
	emails  map[string]struct{}
	domains map[string]struct{}
	loaded  bool
}

// Load reads the runtime_allowlist table into the in-memory cache. Idempotent.
// Called at startup from cmd/server/main.go (so the cache is warm before the
// first signup attempt) and re-entrantly from Add/Remove so a fresh import
// doesn't have to be scripted.
func (h *AdminAllowlistHandler) Load(ctx context.Context) error {
	rows, err := h.Queries.ListAllowlistEntries(ctx)
	if err != nil {
		return err
	}
	emails := make(map[string]struct{}, len(rows))
	domains := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		switch r.Kind {
		case allowlistKindEmail:
			emails[strings.ToLower(r.Value)] = struct{}{}
		case allowlistKindDomain:
			domains[strings.ToLower(strings.TrimPrefix(r.Value, "@"))] = struct{}{}
		}
	}
	h.mu.Lock()
	h.emails = emails
	h.domains = domains
	h.loaded = true
	h.mu.Unlock()
	return nil
}

// SeedFromEnv is called at startup when the runtime_allowlist table is empty.
// It mirrors ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAINS into the table so the
// pre-upgrade allowlist carries forward across the migration. After seeding,
// Load is called so the cache reflects the seeded rows.
func (h *AdminAllowlistHandler) SeedFromEnv(ctx context.Context, allowedEmails, allowedDomains []string) error {
	for _, e := range allowedEmails {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "" {
			continue
		}
		if err := h.Queries.SeedAllowlistFromEnv(ctx, db.SeedAllowlistFromEnvParams{Kind: allowlistKindEmail, Value: e}); err != nil {
			return err
		}
	}
	for _, d := range allowedDomains {
		d = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(d), "@"))
		if d == "" {
			continue
		}
		if err := h.Queries.SeedAllowlistFromEnv(ctx, db.SeedAllowlistFromEnvParams{Kind: allowlistKindDomain, Value: d}); err != nil {
			return err
		}
	}
	return h.Load(ctx)
}

// Has returns the lowercased email hit status. Read-locked so concurrent
// signup requests don't block on Add/Remove.
func (h *AdminAllowlistHandler) Has(email string) (bool, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if !h.loaded {
		return false, false
	}
	_, ok := h.emails[strings.ToLower(strings.TrimSpace(email))]
	return ok, true
}

// HasDomain returns the lowercased-domain hit status.
func (h *AdminAllowlistHandler) HasDomain(domain string) (bool, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if !h.loaded {
		return false, false
	}
	_, ok := h.domains[strings.ToLower(strings.TrimSpace(domain))]
	return ok, true
}

// HasAny reports whether the cache has any entries. Used to flip the
// closed-mode bit so an empty allowlist still honors env-driven open
// signups.
func (h *AdminAllowlistHandler) HasAny() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.emails)+len(h.domains) > 0
}

// Counts returns (emails, domains) for the status strip.
func (h *AdminAllowlistHandler) Counts() (int, int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.emails), len(h.domains)
}

// adminAllowlistEntry is the JSON shape returned by the admin UI. CreatedAt
// is omitted on seed rows where the operator didn't sign in (created_by IS
// NULL is the signal — the frontend decides whether to render "added by").
type adminAllowlistEntry struct {
	Kind      string  `json:"kind"`
	Value     string  `json:"value"`
	CreatedAt string  `json:"created_at"`
	CreatedBy *string `json:"created_by,omitempty"`
}

func toAdminAllowlistEntry(r db.RuntimeAllowlist) adminAllowlistEntry {
	var createdBy *string
	if r.CreatedBy.Valid {
		s := util.UUIDToString(r.CreatedBy)
		createdBy = &s
	}
	return adminAllowlistEntry{
		Kind:      r.Kind,
		Value:     r.Value,
		CreatedAt: timestampToString(r.CreatedAt),
		CreatedBy: createdBy,
	}
}

// List returns every allowlist entry sorted (kind, value).
func (h *AdminAllowlistHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListAllowlistEntries(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list allowlist failed")
		return
	}
	out := make([]adminAllowlistEntry, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAdminAllowlistEntry(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out, "total": int64(len(out))})
}

// allowlistAddRequest is the JSON shape for POST /api/admin/allowlist. The
// caller passes either {"kind":"email","value":"alice@acme.com"} or
// {"kind":"domain","value":"@acme.com"} (the leading @ is accepted and
// stripped before persistence so the cache lookup is consistent).
type allowlistAddRequest struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// Add validates and persists a new entry. Mirrors the cache so subsequent
// signup checks see it without a restart.
func (h *AdminAllowlistHandler) Add(w http.ResponseWriter, r *http.Request) {
	var req allowlistAddRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	kind, value, err := normalizeAllowlistEntry(req.Kind, req.Value)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Make sure the cache is warm before writing — SeedFromEnv relies on this
	// too. If Load fails we refuse to write, otherwise the signup gate would
	// keep denying new signups because the cache is empty.
	if err := h.ensureLoaded(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "allowlist load failed")
		return
	}

	createdBy := middleware.UserIDFromContext(r.Context())
	var createdByUUID pgtype.UUID
	if createdBy != "" {
		if u, err := util.ParseUUID(createdBy); err == nil {
			createdByUUID = u
		}
	}

	row, err := h.Queries.UpsertAllowlistEntry(r.Context(), db.UpsertAllowlistEntryParams{
		Kind:      kind,
		Value:     value,
		CreatedBy: createdByUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "insert failed")
		return
	}

	h.mu.Lock()
	if kind == allowlistKindEmail {
		h.emails[value] = struct{}{}
	} else {
		h.domains[value] = struct{}{}
	}
	h.mu.Unlock()

	writeJSON(w, http.StatusOK, toAdminAllowlistEntry(row))
}

// allowlistDeleteRequest is the JSON shape for DELETE /api/admin/allowlist.
type allowlistDeleteRequest struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// Remove validates and deletes an entry.
func (h *AdminAllowlistHandler) Remove(w http.ResponseWriter, r *http.Request) {
	var req allowlistDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	kind, value, err := normalizeAllowlistEntry(req.Kind, req.Value)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := h.Queries.DeleteAllowlistEntry(r.Context(), db.DeleteAllowlistEntryParams{Kind: kind, Value: value}); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}

	h.mu.Lock()
	if kind == allowlistKindEmail {
		delete(h.emails, value)
	} else {
		delete(h.domains, value)
	}
	h.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"kind": kind, "value": value})
}

// ensureLoaded loads the cache if it hasn't been yet. Called from Add/Remove
// so a fresh process that hasn't called Load() (e.g. tests) still works.
func (h *AdminAllowlistHandler) ensureLoaded(ctx context.Context) error {
	h.mu.RLock()
	loaded := h.loaded
	h.mu.RUnlock()
	if loaded {
		return nil
	}
	return h.Load(ctx)
}

// normalizeAllowlistEntry trims / lowercases and validates. The leading `@`
// on domains is optional in input; we always persist without it so cache
// lookups don't have to repeat the strip.
func normalizeAllowlistEntry(kind, value string) (string, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", "", fmt.Errorf("value is required")
	}
	switch kind {
	case allowlistKindEmail:
		parsed, err := mail.ParseAddress(value)
		if err != nil {
			return "", "", fmt.Errorf("invalid email address")
		}
		// mail.ParseAddress accepts "Name <addr>" — strip the name part.
		addr := parsed.Address
		if at := strings.Index(addr, "@"); at < 0 {
			return "", "", fmt.Errorf("invalid email address")
		}
		return kind, strings.ToLower(addr), nil
	case allowlistKindDomain:
		value = strings.TrimPrefix(value, "@")
		value = strings.ToLower(value)
		if !isValidDomain(value) {
			return "", "", fmt.Errorf("invalid domain (expected something like acme.com)")
		}
		return kind, value, nil
	default:
		return "", "", fmt.Errorf("kind must be 'email' or 'domain'")
	}
}

// isValidDomain is a deliberately small check — RFC 1035 is a tarpit. The
// frontend runs the same regex; this is the server-side backstop.
func isValidDomain(s string) bool {
	if len(s) < 3 || len(s) > 253 {
		return false
	}
	if strings.Contains(s, "..") {
		return false
	}
	labels := strings.Split(s, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 {
			return false
		}
		for _, r := range label {
			if !(r == '-' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
				return false
			}
		}
		if label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
	}
	return true
}

// =============================================================================
// Instance status (header strip)
// =============================================================================

// AdminInstanceHandler backs GET /api/admin/instance. The data is small
// (counts and a couple of timestamps) so it does NOT use sqlc — it composes
// a handful of CountXxx calls and reads the process start time off the
// handler's startTime field. The frontend polls it at status-strip mount.
type AdminInstanceHandler struct {
	Queries   *db.Queries
	StartTime time.Time
	// InstanceName is the public hostname the operator self-identifies with
	// (e.g. "cuinspace.com"). Surfaced verbatim in the status strip.
	InstanceName string
	// SignupOpen mirrors h.cfg.AllowSignup at startup. The signup gate itself
	// is the runtime source of truth; this is the operator-visible summary.
	SignupOpen bool
	// Allowlist is the shared cache so the status strip and the Access tab
	// agree on counts without a second DB round-trip. Nil-safe at handler
	// construction time (we check before reading).
	Allowlist *AdminAllowlistHandler
}

type adminInstanceResponse struct {
	InstanceName      string `json:"instance_name"`
	UptimeSeconds     int64  `json:"uptime_seconds"`
	SignupOpen        bool   `json:"signup_open"`
	AllowlistEmails   int    `json:"allowlist_emails_count"`
	AllowlistDomains  int    `json:"allowlist_domains_count"`
	RuntimesOnline    int64  `json:"runtimes_online"`
	RuntimesTotal     int64  `json:"runtimes_total"`
	LastAdminActionAt *string `json:"last_admin_action_at"`
}

func (h *AdminInstanceHandler) Get(w http.ResponseWriter, r *http.Request) {
	// runtimes_online: count where status='online'. We don't have a dedicated
	// sqlc query for that yet, so reuse ListAllRuntimesAdmin with a small
	// limit and filter in Go. Bounded: a self-hosted instance has tens, not
	// thousands, of runtimes.
	runtimes, err := h.Queries.ListAllRuntimesAdmin(r.Context(), db.ListAllRuntimesAdminParams{
		Limit:  500,
		Offset: 0,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list runtimes failed")
		return
	}
	var online int64
	for _, rt := range runtimes {
		if rt.Status == "online" {
			online++
		}
	}
	var emails, domains int
	if h.Allowlist != nil {
		emails, domains = h.Allowlist.Counts()
	}
	writeJSON(w, http.StatusOK, adminInstanceResponse{
		InstanceName:  h.InstanceName,
		UptimeSeconds: int64(time.Since(h.StartTime).Seconds()),
		SignupOpen:    h.SignupOpen,
		// Allowlist counts come from the admin handler's cache so the status
		// strip and the Access tab see the same numbers without an extra DB
		// hit. The handler exposes a Counts() helper for that purpose.
		AllowlistEmails:  emails,
		AllowlistDomains: domains,
		RuntimesOnline:   online,
		RuntimesTotal:    int64(len(runtimes)),
		// LastAdminActionAt: nil until the audit log ships (Phase 4).
		LastAdminActionAt: nil,
	})
}
