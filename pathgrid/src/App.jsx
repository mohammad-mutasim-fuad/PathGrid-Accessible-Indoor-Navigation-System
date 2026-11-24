import { BrowserRouter, Route, Routes } from 'react-router-dom';
import NavigationPage from './pages/NavigationPage';
import HelpPage from './pages/HelpPage';
import AdminPlaceholderPage from './pages/AdminPlaceholderPage';
import NotFoundPage from './pages/NotFoundPage';

/**
 * Route table. Exported separately so tests can mount it in a MemoryRouter.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<NavigationPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/admin/*" element={<AdminPlaceholderPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
