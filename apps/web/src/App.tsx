import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { STAFF_ROLES } from '@/lib/types';
import { staffLandingPath } from '@/lib/permissions';
import { PortalShell } from '@/components/PortalShell';
import { AdminShell } from '@/components/AdminShell';
import { RequireAdminRole, RequireFeature, RequireSuperAdmin } from '@/components/RequireFeature';
import { PageLoading } from '@/components/PageProgress';
import { Login } from '@/pages/Login';
import { PayLink } from '@/pages/PayLink';

const PortalDashboard = lazy(() =>
  import('@/pages/portal/Dashboard').then((m) => ({ default: m.PortalDashboard })),
);
const PortalOrders = lazy(() =>
  import('@/pages/portal/Orders').then((m) => ({ default: m.PortalOrders })),
);
const PortalOrderDetail = lazy(() =>
  import('@/pages/portal/OrderDetail').then((m) => ({ default: m.PortalOrderDetail })),
);
const PortalQuotes = lazy(() =>
  import('@/pages/portal/Quotes').then((m) => ({ default: m.PortalQuotes })),
);
const PortalQuoteDetail = lazy(() =>
  import('@/pages/portal/QuoteDetail').then((m) => ({ default: m.PortalQuoteDetail })),
);
const PortalNewQuote = lazy(() =>
  import('@/pages/portal/NewQuote').then((m) => ({ default: m.PortalNewQuote })),
);
const PortalProfile = lazy(() =>
  import('@/pages/portal/Profile').then((m) => ({ default: m.PortalProfile })),
);
const PortalFiles = lazy(() =>
  import('@/pages/portal/Files').then((m) => ({ default: m.PortalFiles })),
);
const PortalInvoices = lazy(() =>
  import('@/pages/portal/Invoices').then((m) => ({ default: m.PortalInvoices })),
);
const PortalMessages = lazy(() =>
  import('@/pages/portal/Messages').then((m) => ({ default: m.PortalMessages })),
);

const AdminDashboard = lazy(() =>
  import('@/pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })),
);
const AdminOrders = lazy(() =>
  import('@/pages/admin/Orders').then((m) => ({ default: m.AdminOrders })),
);
const AdminOrderDetail = lazy(() =>
  import('@/pages/admin/OrderDetail').then((m) => ({ default: m.AdminOrderDetail })),
);
const AdminQuotes = lazy(() =>
  import('@/pages/admin/Quotes').then((m) => ({ default: m.AdminQuotes })),
);
const AdminQuoteDetail = lazy(() =>
  import('@/pages/admin/QuoteDetail').then((m) => ({ default: m.AdminQuoteDetail })),
);
const AdminMessages = lazy(() =>
  import('@/pages/admin/Messages').then((m) => ({ default: m.AdminMessages })),
);
const AdminCustomerMessages = lazy(() =>
  import('@/pages/admin/CustomerMessages').then((m) => ({ default: m.AdminCustomerMessages })),
);
const AdminTeamMessages = lazy(() =>
  import('@/pages/admin/TeamMessages').then((m) => ({ default: m.AdminTeamMessages })),
);
const AdminBilling = lazy(() =>
  import('@/pages/admin/Billing').then((m) => ({ default: m.AdminBilling })),
);
const AdminCustomers = lazy(() =>
  import('@/pages/admin/Customers').then((m) => ({ default: m.AdminCustomers })),
);
const AdminTeam = lazy(() =>
  import('@/pages/admin/Team').then((m) => ({ default: m.AdminTeam })),
);
const AdminMyWork = lazy(() =>
  import('@/pages/admin/MyWork').then((m) => ({ default: m.AdminMyWork })),
);
const AdminEdits = lazy(() =>
  import('@/pages/admin/Edits').then((m) => ({ default: m.AdminEdits })),
);
const AdminRolesUsers = lazy(() =>
  import('@/pages/admin/RolesUsers').then((m) => ({ default: m.AdminRolesUsers })),
);
const AdminLoginRequests = lazy(() =>
  import('@/pages/admin/LoginRequests').then((m) => ({ default: m.AdminLoginRequests })),
);
const AdminProfile = lazy(() =>
  import('@/pages/admin/Profile').then((m) => ({ default: m.AdminProfile })),
);
const AdminReports = lazy(() =>
  import('@/pages/admin/Reports').then((m) => ({ default: m.AdminReports })),
);
const AdminAppearance = lazy(() =>
  import('@/pages/admin/Appearance').then((m) => ({ default: m.AdminAppearance })),
);

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!STAFF_ROLES.includes(user.role)) {
    return <Navigate to="/portal" replace />;
  }
  return <Navigate to={staffLandingPath(user.role, user.permissions)} replace />;
}

function RequireRole({
  staff,
  children,
}: {
  staff: boolean;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return <PageLoading />;
  }
  if (!user) return <Navigate to="/login" replace />;
  const isStaff = STAFF_ROLES.includes(user.role);
  if (staff && !isStaff) return <Navigate to="/portal" replace />;
  if (!staff && isStaff) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/pay/:token" element={<PayLink />} />
        <Route path="/" element={<HomeRedirect />} />

        <Route
          path="/portal"
          element={
            <RequireRole staff={false}>
              <PortalShell />
            </RequireRole>
          }
        >
          <Route index element={<PortalDashboard />} />
          <Route path="quotes" element={<PortalQuotes />} />
          <Route path="quotes/new" element={<PortalNewQuote />} />
          <Route path="quotes/:id" element={<PortalQuoteDetail />} />
          <Route path="orders" element={<PortalOrders />} />
          <Route path="orders/:id" element={<PortalOrderDetail />} />
          <Route path="files" element={<PortalFiles />} />
          <Route path="invoices" element={<PortalInvoices />} />
          <Route path="messages" element={<PortalMessages />} />
          <Route path="profile" element={<PortalProfile />} />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireRole staff>
              <AdminShell />
            </RequireRole>
          }
        >
          <Route
            index
            element={
              <RequireFeature feature="dashboard">
                <AdminDashboard />
              </RequireFeature>
            }
          />
          <Route
            path="messages"
            element={
              <RequireFeature
                anyOf={['messages', 'messages_customer_view', 'messages_team_view']}
              >
                <AdminMessages />
              </RequireFeature>
            }
          />
          <Route
            path="messages/customers"
            element={
              <RequireFeature anyOf={['messages', 'messages_customer_view']}>
                <AdminCustomerMessages />
              </RequireFeature>
            }
          />
          <Route
            path="messages/customers/:conversationId"
            element={
              <RequireFeature anyOf={['messages', 'messages_customer_view']}>
                <AdminCustomerMessages />
              </RequireFeature>
            }
          />
          <Route
            path="messages/team"
            element={
              <RequireFeature anyOf={['messages', 'messages_team_view']}>
                <AdminTeamMessages />
              </RequireFeature>
            }
          />
          <Route
            path="orders"
            element={
              <RequireFeature feature="orders">
                <AdminOrders />
              </RequireFeature>
            }
          />
          <Route
            path="orders/:id"
            element={
              <RequireFeature feature="orders">
                <AdminOrderDetail />
              </RequireFeature>
            }
          />
          <Route
            path="quotes"
            element={
              <RequireFeature feature="quotes">
                <AdminQuotes />
              </RequireFeature>
            }
          />
          <Route
            path="quotes/:id"
            element={
              <RequireFeature feature="quotes">
                <AdminQuoteDetail />
              </RequireFeature>
            }
          />
          <Route
            path="edits"
            element={
              <RequireFeature feature="edits">
                <AdminEdits />
              </RequireFeature>
            }
          />
          <Route
            path="customers"
            element={
              <RequireFeature feature="customers">
                <AdminCustomers />
              </RequireFeature>
            }
          />
          <Route
            path="billing"
            element={
              <RequireFeature feature="billing">
                <AdminBilling />
              </RequireFeature>
            }
          />
          <Route
            path="mywork"
            element={
              <RequireFeature feature="orders">
                <AdminMyWork />
              </RequireFeature>
            }
          />
          <Route path="profile" element={<AdminProfile />} />
          <Route
            path="reports"
            element={
              <RequireAdminRole>
                <AdminReports />
              </RequireAdminRole>
            }
          />
          <Route
            path="team"
            element={
              <RequireFeature feature="team">
                <AdminTeam />
              </RequireFeature>
            }
          />
          <Route
            path="roles"
            element={
              <RequireFeature feature="roles">
                <AdminRolesUsers />
              </RequireFeature>
            }
          />
          <Route
            path="login-requests"
            element={
              <RequireFeature feature="customers">
                <AdminLoginRequests />
              </RequireFeature>
            }
          />
          <Route
            path="colors"
            element={
              <RequireSuperAdmin>
                <AdminAppearance />
              </RequireSuperAdmin>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
}
