/**
 * Crown Trade Academy — API Helper
 * Single source of truth for all backend communication.
 * Include this on every page: <script src="api.js"></script>
 */

const API_BASE = 'https://crowntrade-academy-phai.onrender.com/api';

// ── TOKEN / USER STORAGE ────────────────────────────────────────────────────
const Auth = {
  getToken: ()    => localStorage.getItem('ct_token'),
  setToken: (t)   => localStorage.setItem('ct_token', t),
  getUser:  ()    => { try { return JSON.parse(localStorage.getItem('ct_user')); } catch { return null; } },
  setUser:  (u)   => localStorage.setItem('ct_user', JSON.stringify(u)),
  logout:   ()    => { localStorage.removeItem('ct_token'); localStorage.removeItem('ct_user'); localStorage.removeItem('ct_admin_token'); },
  isLoggedIn: ()  => !!localStorage.getItem('ct_token'),
  isAdmin:  ()    => { const u = Auth.getUser(); return u?.type === 'admin' || u?.role === 'admin'; },
  isMentor: ()    => Auth.getUser()?.type === 'mentor',

  // Redirect if not logged in
  requireAuth: (redirectTo = 'login.html') => {
    if (!Auth.getToken()) { window.location.href = redirectTo; return false; }
    return true;
  },
  requireAdmin: () => {
    const token = localStorage.getItem('ct_admin_token') || localStorage.getItem('ct_token');
    if (!token) { window.location.href = 'admin-login.html'; return false; }
    return true;
  }
};

// ── HTTP CORE ───────────────────────────────────────────────────────────────
async function _fetch(path, opts = {}) {
  const token = localStorage.getItem('ct_admin_token') || localStorage.getItem('ct_token');
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    Auth.logout();
    const user = Auth.getUser();
    if (user?.type === 'admin') window.location.href = 'admin-login.html';
    else if (user?.type === 'mentor') window.location.href = 'mentor-login.html';
    else window.location.href = 'login.html';
    throw new Error(data.error || 'Session expired. Please log in again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const get  = (path)       => _fetch(path);
const post = (path, body) => _fetch(path, { method: 'POST', body: JSON.stringify(body) });
const patch = (path, body) => _fetch(path, { method: 'PATCH', body: JSON.stringify(body) });
const put  = (path, body) => _fetch(path, { method: 'PUT', body: JSON.stringify(body) });
const del  = (path)       => _fetch(path, { method: 'DELETE' });

// File upload (multipart)
async function upload(path, formData) {
  const token = localStorage.getItem('ct_admin_token') || localStorage.getItem('ct_token');
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// ── AUTH ────────────────────────────────────────────────────────────────────
const API = {
  // Client auth
  login:          (email, password)          => post('/auth/login', { email, password }),
  register:       (data)                     => post('/auth/register', data),
  getMe:          ()                         => get('/auth/me'),
  updateProfile:  (data)                     => patch('/auth/profile', data),
  changePassword: (data)                     => post('/auth/change-password', data),

  // Admin auth
  adminLogin:     (username, password)       => post('/auth/admin/login', { username, password }),

  // Mentor auth
  mentorLogin:    (email, password)          => post('/mentor/login', { email, password }),
  getMentorProfile: ()                       => get('/mentor/profile'),
  updateMentorProfile: (data)               => patch('/mentor/profile', data),
  mentorChangePassword: (data)              => post('/mentor/change-password', data),

  // ── MENTORSHIP ─────────────────────────────────────────────────────────────
  applyMentorship:   (data)                  => post('/mentorship/apply', data),
  getMentorshipStatus: (email)              => get(`/mentorship/status/${encodeURIComponent(email)}`),

  // ── REFERRAL ───────────────────────────────────────────────────────────────
  registerPartner:   (data)                  => post('/referral/register', data),
  getPartnerDashboard: ()                   => get('/referral/dashboard'),
  checkReferralCode: (code)                 => get(`/referral/check/${encodeURIComponent(code)}`),
  getPartnerSpots:   ()                     => get('/referral/spots'),
  requestWithdrawal: (data)                 => post('/referral/withdraw', data),

  // ── COURSES ────────────────────────────────────────────────────────────────
  getCourses:        ()                      => get('/courses'),
  getCourse:         (slug)                  => get(`/courses/${slug}`),

  // ── ENROLLMENTS ────────────────────────────────────────────────────────────
  enroll:            (data)                  => post('/enrollments/enroll', data),
  getMyCourses:      ()                      => get('/enrollments/my-courses'),
  getEnrollmentDetail: (id)                 => get(`/enrollments/${id}/detail`),
  completeModule:    (enrollId, moduleId)   => post(`/enrollments/${enrollId}/complete-module`, { module_id: moduleId }),

  // ── QUIZ ───────────────────────────────────────────────────────────────────
  submitQuiz:        (moduleId, enrollId, answers) => post('/quiz/attempt', { module_id: moduleId, enrollment_id: enrollId, answers }),

  // ── SESSIONS ───────────────────────────────────────────────────────────────
  getMentorAvailability: (mentorId)         => get(`/sessions/availability/${mentorId}`),
  bookSession:       (data)                 => post('/sessions/book', data),
  getMySessions:     ()                     => get('/sessions/my-sessions'),
  cancelSession:     (id)                   => patch(`/sessions/${id}/cancel`, {}),

  // ── TRADE JOURNAL ──────────────────────────────────────────────────────────
  getJournal:        ()                      => get('/journal'),
  logTrade:          (data)                  => post('/journal', data),
  updateTrade:       (id, data)              => patch(`/journal/${id}`, data),
  deleteTrade:       (id)                    => del(`/journal/${id}`),

  // ── PAYMENTS (Pesapal) ─────────────────────────────────────────────────────
  initiatePayment:   (data)                  => post('/payments/initiate', data),
  getMyPayments:     ()                      => get('/payments/my-payments'),
  checkPaymentStatus: (trackingId)          => get(`/payments/status/${trackingId}`),

  // ── UPLOADS ────────────────────────────────────────────────────────────────
  uploadAvatar:      (file)                  => { const f = new FormData(); f.append('avatar', file); return upload('/upload/avatar', f); },
  uploadMaterial:    (file, name)            => { const f = new FormData(); f.append('material', file); f.append('name', name); return upload('/upload/material', f); },

  // ── MENTOR CONTENT ─────────────────────────────────────────────────────────
  getMentorCourses:  ()                      => get('/mentor/courses'),
  getMentorClients:  ()                      => get('/sessions/mentor/clients'),
  getMentorSessions: ()                      => get('/sessions/mentor/sessions'),
  updateMentorSession: (id, data)           => patch(`/sessions/mentor/${id}`, data),
  setAvailability:   (slots)                => post('/sessions/mentor/availability', { slots }),
  getMentorCourseModules: (courseId)        => get(`/mentor/courses/${courseId}/modules`),
  addModule:         (courseId, data)        => post(`/mentor/courses/${courseId}/modules`, data),
  updateModule:      (moduleId, data)        => patch(`/mentor/modules/${moduleId}`, data),
  saveQuiz:          (moduleId, data)        => put(`/mentor/modules/${moduleId}/quiz`, data),
  saveMaterials:     (moduleId, data)        => put(`/mentor/modules/${moduleId}/materials`, data),
  deleteModule:      (moduleId)              => del(`/mentor/modules/${moduleId}`),
  requestReassignment: (data)               => post('/sessions/mentor/reassign', data),
  getClientQuizScores: (clientId)           => get(`/mentor/clients/${clientId}/quiz-scores`),

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  getAdminStats:     ()                      => get('/admin/stats'),
  getMentorList:     ()                      => get('/admin/mentor-list'),
  createMentor:      (data)                  => post('/admin/mentor/create', data),
  getMentorshipApps: (status='',page=1)     => get(`/admin/mentorship?status=${status}&page=${page}&limit=50`),
  updateMentorshipApp: (id, data)           => patch(`/admin/mentorship/${id}`, data),
  getReferralApps:   (status='',page=1)     => get(`/admin/referral?status=${status}&page=${page}&limit=50`),
  updateReferralApp: (id, data)             => patch(`/admin/referral/${id}`, data),
  getEnrollments:    (status='',page=1)     => get(`/admin/enrollments?status=${status}&page=${page}&limit=50`),
  updateEnrollment:  (id, data)             => patch(`/admin/enrollments/${id}`, data),
  getUsers:          ()                      => get('/admin/users'),
  updateUser:        (id, data)              => patch(`/admin/users/${id}`, data),
  getWithdrawals:    (status='')            => get(`/admin/withdrawals?status=${status}`),
  updateWithdrawal:  (id, data)             => patch(`/admin/withdrawals/${id}`, data),
  releaseCommission: (enrollId)             => post(`/admin/release-commission/${enrollId}`, {}),
  getCapital:        ()                      => get('/admin/capital'),
  getLedgerOverview: ()                      => get('/ledger/overview'),
  getLedgerMonthly:  (months=6)             => get(`/ledger/monthly?months=${months}`),
  getAdminCourses:   ()                      => get('/courses/admin/all'),
  createCourse:      (data)                  => post('/courses/admin/create', data),
  updateCourse:      (id, data)              => patch(`/courses/admin/${id}`, data),
  getAdminPayments:  ()                      => get('/payments/admin/all'),
  getSessions:       (status='')            => get(`/sessions/admin/all${status?`?status=${status}`:''}`),
  getReassignRequests: ()                   => get('/sessions/admin/reassign-requests'),
  reviewReassign:    (id, data)             => _fetch(`/sessions/admin/reassign/${id}`, { method:'PATCH', body: JSON.stringify(data) }),
};

// ── TOAST ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3200) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── LOADING STATE ────────────────────────────────────────────────────────────
function setLoading(btn, loading, originalText) {
  if (loading) {
    btn._orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = originalText || btn._orig || btn.innerHTML;
    btn.disabled = false;
  }
}

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────
function formatKES(amount) { return 'KES ' + (parseFloat(amount)||0).toLocaleString('en-KE'); }
function formatDate(d) { return new Date(d).toLocaleDateString('en-KE', { dateStyle: 'medium' }); }
function formatDateTime(d) { return new Date(d).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }); }
function timeAgo(d) {
  const diff = (Date.now() - new Date(d)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}
