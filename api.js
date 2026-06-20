// Crown Trade Academy — shared API helper
const API_BASE = 'https://crowntrade-academy-phai.onrender.com/api';

const API = {
  // ─── AUTH ──────────────────────────────────────────────────────────────────
  async login(email, password) {
    return await post('/auth/login', { email, password });
  },
  async register(data) {
    return await post('/auth/register', data);
  },
  async adminLogin(username, password) {
    return await post('/auth/admin/login', { username, password });
  },
  async referralLogin(email, referral_code) {
    return await post('/auth/referral/login', { email, referral_code });
  },
  async getMe() {
    return await get('/auth/me');
  },

  // ─── MENTORSHIP ────────────────────────────────────────────────────────────
  async applyMentorship(data) {
    return await post('/mentorship/apply', data);
  },
  async mentorshipLogin(email, password) {
    return await post('/mentorship/login', { email, password });
  },
  async getMentorshipStatus(email) {
    return await get(`/mentorship/status/${encodeURIComponent(email)}`);
  },
  async getMentorshipDashboard() {
    return await get('/mentorship/dashboard');
  },

  // ─── REFERRAL ──────────────────────────────────────────────────────────────
  async registerReferral(data) {
    return await post('/referral/register', data);
  },
  async referralLogin(email, password) {
    return await post('/referral/login', { email, password });
  },
  async getReferralDashboard() {
    return await get('/referral/dashboard');
  },
  async checkReferralCode(code) {
    return await get(`/referral/check/${encodeURIComponent(code)}`);
  },
  async getReferralSpots() {
    return await get('/referral/spots');
  },
  async getReferralStatus(email) {
    return await get(`/referral/status/${encodeURIComponent(email)}`);
  },

  // ─── FILE UPLOAD ───────────────────────────────────────────────────────────
  async uploadPaymentProof(file) {
    const formData = new FormData();
    formData.append('proof', file);
    const token = getToken();
    // Do NOT set Content-Type header — browser sets it automatically with boundary for multipart
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/upload/payment-proof`, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  // ─── ADMIN ─────────────────────────────────────────────────────────────────
  async getAdminStats() {
    return await get('/admin/stats');
  },
  async getMentorshipApplications(status = '', page = 1) {
    return await get(`/admin/mentorship?status=${status}&page=${page}`);
  },
  async updateMentorshipApp(id, data) {
    return await patch(`/admin/mentorship/${id}`, data);
  },
  async getReferralApplications(status = '', page = 1) {
    return await get(`/admin/referral?status=${status}&page=${page}`);
  },
  async updateReferralApp(id, data) {
    return await patch(`/admin/referral/${id}`, data);
  },
  async markEarningPaid(id) {
    return await patch(`/admin/earnings/${id}/pay`, {});
  },
  async getUsers() {
    return await get('/admin/users');
  }
};

// ─── TOKEN HELPERS ────────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('ct_token');
}
function setToken(token) {
  localStorage.setItem('ct_token', token);
}
function setUser(user) {
  localStorage.setItem('ct_user', JSON.stringify(user));
}
function getUser() {
  try { return JSON.parse(localStorage.getItem('ct_user')); } catch { return null; }
}
function logout() {
  localStorage.removeItem('ct_token');
  localStorage.removeItem('ct_user');
}
function isLoggedIn() {
  return !!getToken();
}
function requireAuth(redirectTo = 'login.html') {
  if (!getToken()) { window.location.href = redirectTo; return false; }
  return true;
}
function requireAdminAuth() {
  const token = getToken();
  const user = getUser();
  if (!token || !user || user.role !== 'admin') {
    window.location.href = 'admin-login.html';
    return false;
  }
  return true;
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
async function get(path) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
  const data = await res.json();
  if (res.status === 401 || res.status === 403) {
    // Token expired or invalid — clear and redirect to appropriate login
    const user = getUser();
    const role = user ? user.role : null;
    logout();
    if (role === 'admin') window.location.href = 'admin-login.html';
    else if (role === 'referral') window.location.href = 'referral-login.html';
    else window.location.href = 'login.html';
    throw new Error(data.error || 'Session expired — please log in again');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function post(path, body) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function patch(path, body) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.status === 401 || res.status === 403) {
    const user = getUser();
    const role = user ? user.role : null;
    logout();
    if (role === 'admin') window.location.href = 'admin-login.html';
    else if (role === 'referral') window.location.href = 'referral-login.html';
    else window.location.href = 'login.html';
    throw new Error(data.error || 'Session expired — please log in again');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
