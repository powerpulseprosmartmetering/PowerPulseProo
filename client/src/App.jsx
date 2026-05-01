import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getConsumerToken, getAdminToken } from './services/api';
import HomepageStyled from './components/HomepageStyled';
import ConsumerLogin from './components/ConsumerLogin';
import CustomerDashboard from './components/CustomerDashboard';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';

import DetailedCharts from './components/DetailedCharts';
import BillsPage from './components/BillsPage';
import EventsAlerts from './components/EventsAlerts';
import SettingsConfig from './components/SettingsConfig';

/**
 * Get stored profile from localStorage
 */
const getStoredProfile = (role) => {
  const key = role === 'consumer' ? 'consumerProfile' : 'adminProfile';
  const raw = localStorage.getItem(key);

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};

/**
 * Consumer Protected Route
 * Only allows access if valid consumerToken exists
 */
const ProtectedRoute = ({ children }) => {
  const token = getConsumerToken();
  const consumer = getStoredProfile('consumer');

  if (!token || !consumer) {
    return <Navigate to="/consumer-login" replace />;
  }

  return children;
};

/**
 * Admin Protected Route
 * Only allows access if valid adminToken exists
 */
const AdminProtectedRoute = ({ children }) => {
  const token = getAdminToken();
  const admin = getStoredProfile('admin');

  if (!token || !admin) {
    return <Navigate to="/admin-login" replace />;
  }

  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={<HomepageStyled />} />
        <Route path="/consumer-login" element={<ConsumerLogin />} />
        <Route path="/admin-login" element={<AdminLogin />} />

        {/* Consumer */}
        <Route
          path="/consumer-dashboard"
          element={
            <ProtectedRoute>
              <CustomerDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <CustomerDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/detailed-charts"
          element={
            <ProtectedRoute>
              <DetailedCharts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/detailedcharts"
          element={
            <ProtectedRoute>
              <DetailedCharts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/bills"
          element={
            <ProtectedRoute>
              <BillsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/billspage"
          element={
            <ProtectedRoute>
              <BillsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/events-alerts"
          element={
            <ProtectedRoute>
              <EventsAlerts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/eventsAlerts"
          element={
            <ProtectedRoute>
              <EventsAlerts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsConfig />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settingsconfig"
          element={
            <ProtectedRoute>
              <SettingsConfig />
            </ProtectedRoute>
          }
        />

        {/* Admin */}
        <Route
          path="/admin-dashboard"
          element={
            <AdminProtectedRoute>
              <AdminDashboard />
            </AdminProtectedRoute>
          }
        />

        <Route
          path="/admin/consumer/:consumerId/dashboard"
          element={
            <AdminProtectedRoute>
              <CustomerDashboard adminView={true} />
            </AdminProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
