// Crown Trade Academy — shared API helper
const API_BASE = window.location.origin + '/api';

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
  async getReferralDashboard() {
    return await get('/referral/dashboard');
  },
  async checkReferralCode(code) {
    return await get(`/referral/check/${encodeURIComponent(code)}`);
  },

  // ─── FILE UPLOAD ───────────────────────────────────────────────────────────
  async uploadPaymentProof(file) {
    const formData = new FormData();
    formData.append('proof', file);
    const token = getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/upload/payment-proof`, {
      method: 'POST',
      headers,
      body: formData
    });
    return await res.json();
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
function requireAuth(redirectTo = 'login.html') {
  if (!getToken()) { window.location.href = redirectTo; return false; }
  return true;
}
function requireAdminAuth() {
  const user = getUser();
  if (!getToken() || !user || user.role !== 'admin') {
    window.location.href = 'admin-login.html';
    return false;
  }
  return true;
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
async function get(path) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
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
  if (!res.ok) throw new Error(data.error || 'Request failed');
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
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
