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
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const getTokenByType = (expectedType) => {
  const keys = expectedType === 'consumer'
    ? ['consumerToken', 'token', 'authToken']
    : ['adminToken', 'token', 'authToken'];

  for (const key of keys) {
    const token = localStorage.getItem(key);
    if (!token) continue;
    const payload = decodeJwtPayload(token);
    if (payload?.type === expectedType) {
      return token;
    }
  }

  return null;
};

const getStoredProfile = (role) => {
  const keys = role === 'consumer'
    ? ['consumerProfile', 'user']
    : ['adminProfile', 'admin'];

  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }

  return null;
};

// Protected Route component for consumer pages
const ProtectedRoute = ({ children }) => {
  const token = getTokenByType('consumer');
  const consumer = getStoredProfile('consumer');
  
  // Check if token exists and is not empty
  if (!token || token.trim() === '' || token === 'null' || token === 'undefined') {
    console.log('No valid token found, redirecting to consumer login');
    return <Navigate to="/consumer-login" replace />;
  }

  // Ensure consumer-only routes cannot be opened with admin session token.
  if (!consumer) {
    console.log('No consumer session found, redirecting to consumer login');
    return <Navigate to="/consumer-login" replace />;
  }
  
  return children;
};

// Protected Route component for admin pages
const AdminProtectedRoute = ({ children }) => {
  const token = getTokenByType('admin');
  const admin = getStoredProfile('admin');
  
  // Check if token exists and is not empty
  if (!token || token.trim() === '' || token === 'null' || token === 'undefined') {
    console.log('No valid token found, redirecting to admin login');
    return <Navigate to="/admin-login" replace />;
  }

  if (!admin) {
    console.log('No admin session found, redirecting to admin login');
    return <Navigate to="/admin-login" replace />;
  }
  
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes - accessible to everyone */}
        <Route path="/" element={<HomepageStyled />} />
        <Route path="/consumer-login" element={<ConsumerLogin />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        
        {/* Protected Consumer Routes - require authentication */}
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
        
        {/* Protected Admin Routes - require authentication */}
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
        
        {/* Other Protected Routes */}
        <Route 
          path="/detailed-charts" 
          element={
            <ProtectedRoute>
              <DetailedCharts />
            </ProtectedRoute>
          } 
        />
        {/* Alternate path per user request */}
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
        
        {/* Redirect any unknown routes to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
