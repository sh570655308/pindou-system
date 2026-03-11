import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import InventoryLogs from './pages/InventoryLogs';
import Drawings from './pages/Drawings';
import PendingDrawings from './pages/PendingDrawings';
import PixelatePage from './pages/Pixelate';
import Admin from './pages/Admin';
import Orders from './pages/Orders';
import SalesOrders from './pages/SalesOrders';
import Settings from './pages/Settings';
import CompletionRecords from './pages/CompletionRecords';
import Reports from './pages/Reports';
import TabBar from './components/TabBar';
import './App.css';

// 主布局组件（包含标签栏）
const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-gray-50 pt-16">
      <TabBar />
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
};

// 受保护的路由组件
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? (
    <MainLayout>
      {children}
    </MainLayout>
  ) : (
    <Navigate to="/login" />
  );
};

// 管理员路由组件
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!isAdmin) return <Navigate to="/" />;
  return (
    <MainLayout>
      {children}
    </MainLayout>
  );
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" /> : <Login />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute>
            <Inventory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/logs/:productId"
        element={
          <ProtectedRoute>
            <InventoryLogs />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drawings"
        element={
          <ProtectedRoute>
            <Drawings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pending-drawings"
        element={
          <ProtectedRoute>
            <PendingDrawings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/completions"
        element={
          <ProtectedRoute>
            <CompletionRecords />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <Reports />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pixelate"
        element={
          <ProtectedRoute>
            <PixelatePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      {/* consumption route removed */}
      <Route
        path="/orders"
        element={
          <ProtectedRoute>
            <Orders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales-orders"
        element={
          <ProtectedRoute>
            <SalesOrders />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <Admin />
          </AdminRoute>
        }
      />
    </Routes>
  );
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;