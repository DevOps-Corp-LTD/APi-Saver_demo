import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      verifyToken();
    } else {
      setLoading(false);
    }
  }, []);

  const verifyToken = async () => {
    try {
      const response = await api.get('/api/v1/auth/verify');
      setUser(response.data.app);
      setRole(response.data.role || 'viewer');
    } catch (error) {
      logout();
    } finally {
      setLoading(false);
    }
  };

  // Login with API key (gives admin role)
  const login = async (apiKey) => {
    const response = await api.post('/api/v1/auth/login', { api_key: apiKey });
    const { token: newToken, app, role: userRole } = response.data;
    
    localStorage.setItem('token', newToken);
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    setToken(newToken);
    setUser(app);
    setRole(userRole || 'admin');
    
    return response.data;
  };

  // Login with email/password (API key optional - backend will find user by email if not provided)
  const loginWithPassword = async (apiKey, email, password) => {
    const headers = {};
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    const response = await api.post('/api/v1/auth/login', 
      { email, password },
      { headers }
    );
    const { token: newToken, app, role: userRole, user: userData } = response.data;
    
    localStorage.setItem('token', newToken);
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey);
    }
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    setToken(newToken);
    setUser({ ...app, ...userData });
    setRole(userRole || 'viewer');
    
    return response.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('apiKey');
    delete api.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
    setRole(null);
  };

  const isAdmin = role === 'admin';

  return (
    <AuthContext.Provider value={{ 
      user, 
      role,
      token, 
      loading, 
      login, 
      loginWithPassword,
      logout, 
      isAuthenticated: !!token,
      isAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

