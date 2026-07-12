// Enterprise fork (CUinspace233/multica): /admin route entry.
//
// Server component shell. Mounts:
//   - <StatusStrip /> — instance-wide stats, fetched server-side
//   - <AdminDashboard /> — client component with the 4 Tabs
//
// Layout guard (is_admin check + redirect) lives in (admin)/layout.tsx so
// non-admins are bounced before any of this downloads.
import { StatusStrip } from "./status-strip";
import { AdminDashboard } from "./admin-dashboard";
import { AdminMobileHeader } from "./admin-mobile-header";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AdminMobileHeader />
      <StatusStrip />
      <AdminDashboard />
    </div>
  );
}