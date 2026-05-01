import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomepageStyled from './components/HomepageStyled';
import ConsumerLogin from './components/ConsumerLogin';
import CustomerDashboard from './components/CustomerDashboard';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';

import DetailedCharts from './components/DetailedCharts';
import BillsPage from './components/BillsPage';
import EventsAlerts from './components/EventsAlerts';
import SettingsConfig from './components/SettingsConfig';

const decodeJwtPayload = (token) => {
  try {
    if (!token || typeof token !== 'string') return null;

    const part = token.split('.')[1];
    if (!part) return null;

    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const isTokenExpired = (token) => {
  const payload = decodeJwtPayload(token);

  if (!payload?.exp) return false;

  return Date.now() >= payload.exp * 1000;
};

const getTokenByType = (expectedType) => {
  const keys =
    expectedType === 'consumer'
      ? ['consumerToken', 'token', 'authToken']
      : ['adminToken', 'token', 'authToken'];

  for (const key of keys) {
    const token = localStorage.getItem(key);

    if (!token) continue;

    if (
      token === 'null' ||
      token === 'undefined' ||
      token.trim() === ''
    ) {
      continue;
    }

    if (isTokenExpired(token)) {
      localStorage.removeItem(key);
      continue;
    }

    const payload = decodeJwtPayload(token);

    if (
      payload?.type === expectedType ||
      payload?.role === expectedType ||
      (expectedType === 'admin' &&
        ['admin', 'super-admin'].includes(payload?.role))
    ) {
      return token;
    }
  }

  return null;
};

const getStoredProfile = (role) => {
  const keys =
    role === 'consumer'
      ? ['consumerProfile', 'user']
      : ['adminProfile', 'admin'];

  for (const key of keys) {
    const raw = localStorage.getItem(key);

    if (!raw) continue;

    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem(key);
    }
  }

  return null;
};

/* ---------------- Consumer Protected Route ---------------- */

const ProtectedRoute = ({ children }) => {
  const token = getTokenByType('consumer');
  const consumer = getStoredProfile('consumer');

  if (!token || !consumer) {
    return <Navigate to="/consumer-login" replace />;
  }

  return children;
};

/* ---------------- Admin Protected Route ---------------- */

const AdminProtectedRoute = ({ children }) => {
  const token = getTokenByType('admin');
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
