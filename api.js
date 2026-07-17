// Crown Trade Academy — shared API helper
const API_BASE = 'https://crowntrade-academy-phai.onrender.com/api';

const API = {
  // ── AUTH ───────────────────────────────────────────────────────────────────
  async login(email, password)          { return post('/auth/login', { email, password }); },
  async register(data)                  { return post('/auth/register', data); },
  async adminLogin(username, password)  { return post('/auth/admin/login', { username, password }); },
  async referralLogin(email, password)  { return post('/auth/referral/login', { email, password }); },
  async getMe()                         { return get('/auth/me'); },
  async updateProfile(data)             { return patch('/auth/profile', data); },
  async changePassword(data)            { return post('/auth/change-password', data); },

  // ── MENTORSHIP ─────────────────────────────────────────────────────────────
  async applyMentorship(data)           { return post('/mentorship/apply', data); },
  async mentorshipLogin(email, password){ return post('/mentorship/login', { email, password }); },
  async getMentorshipStatus(email)      { return get(`/mentorship/status/${encodeURIComponent(email)}`); },
  async getMentorshipDashboard()        { return get('/mentorship/dashboard'); },

  // ── REFERRAL ───────────────────────────────────────────────────────────────
  async registerReferral(data)          { return post('/referral/register', data); },
  async getReferralDashboard()          { return get('/referral/dashboard'); },
  async checkReferralCode(code)         { return get(`/referral/check/${encodeURIComponent(code)}`); },
  async getReferralSpots()              { return get('/referral/spots'); },
  async getReferralStatus(email)        { return get(`/referral/status/${encodeURIComponent(email)}`); },
  async requestWithdrawal(data)         { return post('/referral/withdraw', data); },

  // ── COURSES ────────────────────────────────────────────────────────────────
  async getCourses()                    { return get('/courses'); },
  async getCourse(slug)                 { return get(`/courses/${slug}`); },

  // ── ENROLLMENTS ────────────────────────────────────────────────────────────
  async enrollInCourse(data)            { return post('/enrollments/enroll', data); },
  async enrollmentLogin(email, password){ return post('/enrollments/login', { email, password }); },
  async submitEnrollmentProof(email, enrollment_id, proof_url) {
    return post('/enrollments/payment-proof', { email, enrollment_id, proof_url });
  },
  async getMyCourses()                  { return get('/enrollments/my-courses'); },
  async getEnrollmentDetail(id)         { return get(`/enrollments/${id}/detail`); },
  async completeModule(enrollmentId, moduleId) {
    return post(`/enrollments/${enrollmentId}/complete-module`, { module_id: moduleId });
  },
  async getEnrollmentStatus(email)      { return get(`/enrollments/status/${encodeURIComponent(email)}`); },

  // ── QUIZ ───────────────────────────────────────────────────────────────────
  async submitQuiz(module_id, enrollment_id, answers) {
    return post('/quiz/attempt', { module_id, enrollment_id, answers });
  },
  async getQuizAttempts(moduleId)       { return get(`/quiz/attempts/${moduleId}`); },

  // ── SESSIONS ───────────────────────────────────────────────────────────────
  async getMentorAvailability(mentorId) { return get(`/sessions/availability/${mentorId}`); },
  async bookSession(data)               { return post('/sessions/book', data); },
  async getMySessions()                 { return get('/sessions/my-sessions'); },
  async cancelSession(id)               { return patch(`/sessions/${id}/cancel`, {}); },

  // ── TRADE JOURNAL ──────────────────────────────────────────────────────────
  async getJournal()                    { return get('/journal'); },
  async logTrade(data)                  { return post('/journal', data); },
  async updateTrade(id, data)           { return patch(`/journal/${id}`, data); },
  async deleteTrade(id)                 { return del(`/journal/${id}`); },

  // ── FILE UPLOAD ────────────────────────────────────────────────────────────
  async uploadPaymentProof(file) {
    const formData = new FormData();
    formData.append('proof', file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/upload/payment-proof`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  // ── ADMIN: COURSES ─────────────────────────────────────────────────────────
  async getAdminCourses()                   { return get('/courses/admin/all'); },
  async createCourse(data)                  { return post('/courses/admin/create', data); },
  async updateCourse(id, data)              { return patch(`/courses/admin/${id}`, data); },
  async deleteCourseAdmin(id)               { return del(`/courses/admin/${id}`); },
  async getCourseModulesAdmin(courseId)     { return get(`/courses/admin/${courseId}/modules`); },
  async addCourseModule(courseId, data)     { return post(`/courses/admin/${courseId}/modules`, data); },
  async updateCourseModule(moduleId, data)  { return patch(`/courses/admin/modules/${moduleId}`, data); },
  async deleteCourseModule(moduleId)        { return del(`/courses/admin/modules/${moduleId}`); },

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  async getAdminStats()                     { return get('/admin/stats'); },
  async getMentorshipApplications(status='', page=1) { return get(`/admin/mentorship?status=${status}&page=${page}`); },
  async updateMentorshipApp(id, data)       { return patch(`/admin/mentorship/${id}`, data); },
  async getReferralApplications(status='', page=1)   { return get(`/admin/referral?status=${status}&page=${page}`); },
  async updateReferralApp(id, data)         { return patch(`/admin/referral/${id}`, data); },
  async getAdminEnrollments(status='', course_id='', page=1) { return get(`/admin/enrollments?status=${status}&course_id=${course_id}&page=${page}`); },
  async updateEnrollment(id, data)          { return patch(`/admin/enrollments/${id}`, data); },
  async getUsers()                          { return get('/admin/users'); },
  async getCapitalOverview()                { return get('/admin/capital'); },
  async getWithdrawals(status='')           { return get(`/admin/withdrawals?status=${status}`); },
  async updateWithdrawal(id, data)          { return patch(`/admin/withdrawals/${id}`, data); },
  async releaseCommission(enrollmentId)     { return post(`/admin/release-commission/${enrollmentId}`, {}); },
  async releaseEarning(id)                  { return patch(`/admin/earnings/${id}/release`, {}); },
  async markEarningPaid(id)                 { return patch(`/admin/earnings/${id}/pay`, {}); },
  async updateSpots(total_spots)            { return patch('/admin/spots', { total_spots }); },

  // ── LEDGER ─────────────────────────────────────────────────────────────────
  async getLedgerOverview()             { return get('/ledger/overview'); },
  async getLedgerMonthly(months=6)      { return get(`/ledger/monthly?months=${months}`); },
  async seedTestData()                  { return post('/ledger/seed-test-data', {}); },

  // ── MENTOR AUTH ────────────────────────────────────────────────────────────
  async mentorLogin(email, password)    { return post('/mentor/login', { email, password }); },
  async getMentorProfile()              { return get('/mentor/profile'); },
  async updateMentorProfile(data)       { return patch('/mentor/profile', data); },
  async getMentorCourses()              { return get('/mentor/courses'); },
  async getMentorClients()              { return get('/sessions/mentor/clients'); },
  async getMentorSessions()             { return get('/sessions/mentor/sessions'); },
  async updateMentorSession(id, data)   { return patch(`/sessions/mentor/${id}`, data); },
  async setMentorAvailability(slots)    { return post('/sessions/mentor/availability', { slots }); },
  async getMentorCourseModules(courseId){ return get(`/mentor/courses/${courseId}/modules`); },
  async addMentorModule(courseId, data) { return post(`/mentor/courses/${courseId}/modules`, data); },
  async updateMentorModule(moduleId, data){ return patch(`/mentor/modules/${moduleId}`, data); },
  async saveMentorQuiz(moduleId, data)  { return put(`/mentor/modules/${moduleId}/quiz`, data); },
  async saveMentorMaterials(moduleId, data){ return put(`/mentor/modules/${moduleId}/materials`, data); },
  async deleteMentorModule(moduleId)    { return del(`/mentor/modules/${moduleId}`); },
  async requestReassignment(data)       { return post('/sessions/mentor/reassign', data); },
  async getClientQuizScores(clientId)   { return get(`/mentor/clients/${clientId}/quiz-scores`); },
};

// ── TOKEN / USER HELPERS ───────────────────────────────────────────────────────
function getToken()  { return localStorage.getItem('ct_token'); }
function setToken(t) { localStorage.setItem('ct_token', t); }
function setUser(u)  { localStorage.setItem('ct_user', JSON.stringify(u)); }
function getUser()   { try { return JSON.parse(localStorage.getItem('ct_user')); } catch { return null; } }
function logout()    { localStorage.removeItem('ct_token'); localStorage.removeItem('ct_user'); }
function isLoggedIn(){ return !!getToken(); }
function requireAuth(redirectTo = 'login.html') {
  if (!getToken()) { window.location.href = redirectTo; return false; }
  return true;
}

// ── HTTP HELPERS ───────────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...authHeader() }
  });
  return handleResponse(res);
}
async function post(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}
async function patch(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}
async function put(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}
async function del(path) {
  const res = await fetch(API_BASE + path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeader() }
  });
  return handleResponse(res);
}
function authHeader() {
  const t = getToken();
  return t ? { 'Authorization': `Bearer ${t}` } : {};
}
async function handleResponse(res) {
  const data = await res.json();
  if (res.status === 401 || res.status === 403) {
    logout();
    const u = getUser();
    if (u?.type === 'admin') window.location.href = 'admin-login.html';
    else if (u?.type === 'mentor') window.location.href = 'mentor-login.html';
    else window.location.href = 'login.html';
    throw new Error(data.error || 'Session expired');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
