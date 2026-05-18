import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { LiveTrackingPage } from './pages/LiveTrackingPage';
import { HistoryPage } from './pages/HistoryPage';
import { QualityTrackingPage } from './pages/QualityTrackingPage';
import { PartsPage } from './pages/PartsPage';
import { UsersPage } from './pages/UsersPage';

export const router = createBrowserRouter([
  { path: '/login', Component: LoginPage },
  { path: '/', element: <Navigate to="/login" replace /> },
  {
    path: '/',
    Component: Layout,
    children: [
      { path: 'dashboard', Component: DashboardPage },
      { path: 'live-tracking', Component: LiveTrackingPage },
      { path: 'history', Component: HistoryPage },
      { path: 'quality-tracking', Component: QualityTrackingPage },
      { path: 'parts', Component: PartsPage },
      { path: 'users', Component: UsersPage },
    ],
  },
  { path: '*', element: <Navigate to="/login" /> },
]);