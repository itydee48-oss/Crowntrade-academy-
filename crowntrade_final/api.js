const API_BASE = 'https://crowntrade-academy-phai.onrender.com/api';

const Auth = {
  getToken:()=>localStorage.getItem('ct_admin_token')||localStorage.getItem('ct_token'),
  setToken:(t)=>localStorage.setItem('ct_token',t),
  getUser:()=>{try{return JSON.parse(localStorage.getItem('ct_user'));}catch{return null;}},
  setUser:(u)=>localStorage.setItem('ct_user',JSON.stringify(u)),
  logout:()=>{localStorage.removeItem('ct_token');localStorage.removeItem('ct_user');localStorage.removeItem('ct_admin_token');},
  isLoggedIn:()=>!!localStorage.getItem('ct_token'),
  isAdmin:()=>{const u=Auth.getUser();return u?.type==='admin'||u?.role==='admin';},
  isMentor:()=>Auth.getUser()?.type==='mentor',
  requireAuth:(r='login.html')=>{if(!Auth.getToken()){window.location.href=r;return false;}return true;},
};

async function _fetch(path,opts={}){
  const token=Auth.getToken();
  const res=await fetch(API_BASE+path,{...opts,headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{}),...(opts.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(res.status===401||res.status===403){Auth.logout();const u=Auth.getUser();window.location.href=u?.type==='admin'?'admin-login.html':u?.type==='mentor'?'mentor-login.html':'login.html';throw new Error(data.error||'Session expired');}
  if(!res.ok)throw new Error(data.error||`Request failed (${res.status})`);
  return data;
}

const get=(path)=>_fetch(path);
const post=(path,body)=>_fetch(path,{method:'POST',body:JSON.stringify(body)});
const patch=(path,body)=>_fetch(path,{method:'PATCH',body:JSON.stringify(body)});
const put=(path,body)=>_fetch(path,{method:'PUT',body:JSON.stringify(body)});
const del=(path)=>_fetch(path,{method:'DELETE'});

async function upload(path,formData){
  const token=Auth.getToken();
  const res=await fetch(API_BASE+path,{method:'POST',headers:token?{'Authorization':'Bearer '+token}:{},body:formData});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Upload failed');
  return data;
}

const API={
  login:(email,password)=>post('/auth/login',{email,password}),
  register:(data)=>post('/auth/register',data),
  adminLogin:(username,password)=>post('/auth/admin/login',{username,password}),
  mentorLogin:(email,password)=>post('/mentor/login',{email,password}),
  getMe:()=>get('/auth/me'),
  updateProfile:(data)=>patch('/auth/profile',data),
  changePassword:(data)=>post('/auth/change-password',data),
  applyMentorship:(data)=>post('/mentorship/apply',data),
  getMentorshipStatus:(email)=>get(`/mentorship/status/${encodeURIComponent(email)}`),
  registerPartner:(data)=>post('/referral/register',data),
  getPartnerDashboard:()=>get('/referral/dashboard'),
  checkReferralCode:(code)=>get(`/referral/check/${encodeURIComponent(code)}`),
  getPartnerSpots:()=>get('/referral/spots'),
  requestWithdrawal:(data)=>post('/referral/withdraw',data),
  getCourses:()=>get('/courses'),
  getCourse:(slug)=>get(`/courses/${slug}`),
  enroll:(data)=>post('/enrollments/enroll',data),
  getMyCourses:()=>get('/enrollments/my-courses'),
  getEnrollmentDetail:(id)=>get(`/enrollments/${id}/detail`),
  completeModule:(enrollId,moduleId)=>post(`/enrollments/${enrollId}/complete-module`,{module_id:moduleId}),
  submitPaymentProof:(email,enrollment_id,proof_url)=>post('/enrollments/payment-proof',{email,enrollment_id,proof_url}),
  submitQuiz:(moduleId,enrollId,answers)=>post('/quiz/attempt',{module_id:moduleId,enrollment_id:enrollId,answers}),
  bookSession:(data)=>post('/sessions/book',data),
  getMySessions:()=>get('/sessions/my-sessions'),
  cancelSession:(id)=>patch(`/sessions/${id}/cancel`,{}),
  getMentorAvailability:(mentorId)=>get(`/sessions/availability/${mentorId}`),
  getJournal:()=>get('/journal'),
  logTrade:(data)=>post('/journal',data),
  updateTrade:(id,data)=>patch(`/journal/${id}`,data),
  deleteTrade:(id)=>del(`/journal/${id}`),
  initiatePayment:(data)=>post('/payments/initiate',data),
  getMyPayments:()=>get('/payments/my-payments'),
  uploadAvatar:(file)=>{const f=new FormData();f.append('avatar',file);return upload('/upload/avatar',f);},
  uploadPaymentProof:(file)=>{const f=new FormData();f.append('proof',file);return upload('/upload/payment-proof',f);},
  uploadMaterial:(file,name)=>{const f=new FormData();f.append('material',file);if(name)f.append('name',name);return upload('/upload/material',f);},
  getMentorProfile:()=>get('/mentor/profile'),
  updateMentorProfile:(data)=>patch('/mentor/profile',data),
  mentorChangePassword:(data)=>post('/mentor/change-password',data),
  getMentorCourses:()=>get('/mentor/courses'),
  getMentorCourseModules:(courseId)=>get(`/mentor/courses/${courseId}/modules`),
  addModule:(courseId,data)=>post(`/mentor/courses/${courseId}/modules`,data),
  updateModule:(moduleId,data)=>patch(`/mentor/modules/${moduleId}`,data),
  saveQuiz:(moduleId,data)=>put(`/mentor/modules/${moduleId}/quiz`,data),
  saveMaterials:(moduleId,data)=>put(`/mentor/modules/${moduleId}/materials`,data),
  deleteModule:(moduleId)=>del(`/mentor/modules/${moduleId}`),
  getMentorClients:()=>get('/sessions/mentor/clients'),
  getMentorSessions:()=>get('/sessions/mentor/sessions'),
  updateMentorSession:(id,data)=>patch(`/sessions/mentor/${id}`,data),
  setAvailability:(slots)=>post('/sessions/mentor/availability',{slots}),
  requestReassignment:(data)=>post('/sessions/mentor/reassign',data),
  getClientQuizScores:(clientId)=>get(`/mentor/clients/${clientId}/quiz-scores`),
  getAdminStats:()=>get('/admin/stats'),
  getMentorList:()=>get('/admin/mentor-list'),
  createMentor:(data)=>post('/admin/mentor/create',data),
  getMentorshipApps:(status='',page=1)=>get(`/admin/mentorship?status=${status}&page=${page}&limit=50`),
  updateMentorshipApp:(id,data)=>patch(`/admin/mentorship/${id}`,data),
  getReferralApps:(status='',page=1)=>get(`/admin/referral?status=${status}&page=${page}&limit=50`),
  updateReferralApp:(id,data)=>patch(`/admin/referral/${id}`,data),
  getEnrollments:(status='',page=1)=>get(`/admin/enrollments?status=${status}&page=${page}&limit=50`),
  updateEnrollment:(id,data)=>patch(`/admin/enrollments/${id}`,data),
  getUsers:()=>get('/admin/users'),
  updateUser:(id,data)=>patch(`/admin/users/${id}`,data),
  getWithdrawals:(status='')=>get(`/admin/withdrawals?status=${status}`),
  updateWithdrawal:(id,data)=>patch(`/admin/withdrawals/${id}`,data),
  getCapital:()=>get('/admin/capital'),
  getLedgerOverview:()=>get('/ledger/overview'),
  getLedgerMonthly:(months=6)=>get(`/ledger/monthly?months=${months}`),
  getAdminCourses:()=>get('/courses/admin/all'),
  createCourse:(data)=>post('/courses/admin/create',data),
  updateCourse:(id,data)=>patch(`/courses/admin/${id}`,data),
  getAdminPayments:()=>get('/payments/admin/all'),
  getSessions:(status='')=>get(`/sessions/admin/all${status?`?status=${status}`:''}`),
  getReassignRequests:()=>get('/sessions/admin/reassign-requests'),
  reviewReassign:(id,data)=>_fetch(`/sessions/admin/reassign/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
};

function showToast(msg,type='info',duration=3200){
  let wrap=document.getElementById('toast-wrap');
  if(!wrap){wrap=document.createElement('div');wrap.id='toast-wrap';wrap.className='toast-wrap';document.body.appendChild(wrap);}
  const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;
  wrap.appendChild(t);setTimeout(()=>t.remove(),duration);
}

function setLoading(btn,loading){
  if(loading){btn._orig=btn.innerHTML;btn.innerHTML='<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>';btn.disabled=true;}
  else{btn.innerHTML=btn._orig||btn.innerHTML;btn.disabled=false;}
}

function formatKES(amount){return 'KES '+(parseFloat(amount)||0).toLocaleString('en-KE');}
function formatDate(d){return new Date(d).toLocaleDateString('en-KE',{dateStyle:'medium'});}
function formatDateTime(d){return new Date(d).toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'});}
