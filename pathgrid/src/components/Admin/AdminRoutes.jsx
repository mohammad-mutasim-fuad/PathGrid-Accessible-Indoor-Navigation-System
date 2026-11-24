import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminAuthProvider, RequireAdmin } from './AdminAuthContext';
import { AdminDataProvider } from './AdminDataContext';
import AdminLayout from './AdminLayout';
import Login from './Login';
import Dashboard from './Dashboard';
import Editor from './Editor';
import Settings from './Settings';

/**
 * All /admin/* routes. Loaded lazily from App.jsx so the admin portal (and
 * firebase/auth) is not part of the public bundle.
 */
export default function AdminRoutes() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route
          element={(
            <RequireAdmin>
              <AdminDataProvider>
                <AdminLayout />
              </AdminDataProvider>
            </RequireAdmin>
          )}
        >
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="editor" element={<Editor />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
