import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AuthGate from './components/AuthGate';
import Layout from './components/Layout';
import RiderPage from './pages/RiderPage';
import DriverPage from './pages/DriverPage';
import HistoryPage from './pages/HistoryPage';
import AdminIncidentsPage from './pages/AdminIncidentsPage';
import AdminPaymentsPage from './pages/AdminPaymentsPage';
import AdminIntegrityPage from './pages/AdminIntegrityPage';
import WalletPage from './pages/WalletPage';

export default function App() {
  return (
    <AuthGate>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/rider" replace />} />
          <Route path="/rider" element={<RiderPage />} />
          <Route path="/driver" element={<DriverPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/incidents" element={<AdminIncidentsPage />} />
          <Route path="/admin/integrity" element={<AdminIntegrityPage />} />
          <Route path="*" element={<div className="p-6">Not found</div>} />
        </Routes>
      </Layout>
    </AuthGate>
  );
}
