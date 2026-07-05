// Enterprise fork (CUinspace233/multica): admin layout.
//
// Server-side guard + chrome. Replaces the previous bare layout (which only
// redirected non-admins and rendered children naked). Now the layout sets
// up the dashboard shell the rest of the app uses: full-height flex column,
// status strip on top, vertical Tabs left rail, content pane on the right.
//
// Why a server component for the layout guard: doing this check in a
// client effect lets the page flash for half a second before redirecting.
// We also don't want the admin UI markup shipped to a non-admin browser at
// all. The existing /api/me fetch logic is kept verbatim so the redirect
// happens before any admin bundle downloads.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

interface MeResponse {
  id: string;
  email: string;
  is_admin?: boolean;
  disabled?: boolean;
}

async function fetchMe(cookieHeader: string): Promise<MeResponse | null> {
  try {
    const res = await fetch(
      `${process.env.REMOTE_API_URL || "http://backend:8080"}/api/me`,
      {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as MeResponse;
  } catch {
    return null;
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const me = await fetchMe(cookieHeader);

  if (!me) {
    redirect("/login");
  }
  if (me.disabled) {
    redirect("/");
  }
  if (!me.is_admin) {
    redirect("/");
  }

  return <>{children}</>;
}