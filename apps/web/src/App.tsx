import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { STAFF_ROLES } from '@/lib/types';
import { PortalShell } from '@/components/PortalShell';
import { AdminShell } from '@/components/AdminShell';
import { RequireFeature } from '@/components/RequireFeature';
import { Login } from '@/pages/Login';
import { PayLink } from '@/pages/PayLink';

// Portal pages
import { PortalDashboard } from '@/pages/portal/Dashboard';
import { PortalOrders } from '@/pages/portal/Orders';
import { PortalOrderDetail } from '@/pages/portal/OrderDetail';
import { PortalQuotes } from '@/pages/portal/Quotes';
import { PortalQuoteDetail } from '@/pages/portal/QuoteDetail';
import { PortalNewQuote } from '@/pages/portal/NewQuote';
import { PortalProfile } from '@/pages/portal/Profile';
import { PortalFiles } from '@/pages/portal/Files';
import { PortalInvoices } from '@/pages/portal/Invoices';
import { PortalMessages } from '@/pages/portal/Messages';

// Admin pages
import { AdminDashboard } from '@/pages/admin/Dashboard';
import { AdminOrders } from '@/pages/admin/Orders';
import { AdminOrderDetail } from '@/pages/admin/OrderDetail';
import { AdminQuotes } from '@/pages/admin/Quotes';
import { AdminQuoteDetail } from '@/pages/admin/QuoteDetail';
import { AdminMessages } from '@/pages/admin/Messages';
import { AdminCustomerMessages } from '@/pages/admin/CustomerMessages';
import { AdminTeamMessages } from '@/pages/admin/TeamMessages';
import { AdminBilling } from '@/pages/admin/Billing';
import { AdminCustomers } from '@/pages/admin/Customers';
import { AdminTeam } from '@/pages/admin/Team';
import { AdminMyWork } from '@/pages/admin/MyWork';
import { AdminEdits } from '@/pages/admin/Edits';
import { AdminRolesUsers } from '@/pages/admin/RolesUsers';
import { AdminLoginRequests } from '@/pages/admin/LoginRequests';

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Navigate to={STAFF_ROLES.includes(user.role) ? '/admin' : '/portal'} replace />
  );
}

function RequireRole({
  staff,
  children,
}: {
  staff: boolean;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
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
        <Route index element={<AdminDashboard />} />
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
        <Route path="mywork" element={<AdminMyWork />} />
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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
