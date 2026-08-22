import { Navigate } from 'react-router-dom';

/** Legacy `/admin/messages` entry. Redirect into Customer Messages. */
export function AdminMessages() {
  return <Navigate to="/admin/messages/customers" replace />;
}
