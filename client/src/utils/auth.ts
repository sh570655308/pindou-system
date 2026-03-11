import api from './api';

export interface User {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

export const authService = {
  login: (username: string, password: string) => {
    return api.post('/auth/login', { username, password });
  },
  register: (username: string, password: string) => {
    return api.post('/auth/register', { username, password });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  getCurrentUser: (): User | null => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },
  isAuthenticated: (): boolean => {
    return !!localStorage.getItem('token');
  },
  isAdmin: (): boolean => {
    const user = authService.getCurrentUser();
    return user?.role === 'admin';
  },
};
