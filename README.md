# Crown Trade Academy — Setup Guide

## Project Structure
```
crowntraders-academy/
├── index.html                  ✅ Fixed (broken CTA link, stats display, mobile nav)
├── login.html                  ✅ Rebuilt (was a stub — now full login + register)
├── mentorship-form.html        ✅ Fixed (truncated JS, wired to API)
├── referral-register.html      ✅ Fixed (was using localStorage — now real API)
├── referral-login.html         ✅ New file
├── api.js                      ✅ New — shared API helper for all pages
├── [other pages unchanged]
└── backend/
    ├── server.js               ← Entry point
    ├── package.json
    ├── .env.example            ← Copy to .env and configure
    ├── database/
    │   └── db.js               ← SQLite schema + auto-init
    ├── middleware/
    │   └── auth.js             ← JWT auth middleware
    ├── routes/
    │   ├── auth.js             ← Login, register, admin login, referral login
    │   ├── mentorship.js       ← Mentorship applications
    │   ├── referral.js         ← Referral program
    │   ├── admin.js            ← Admin dashboard API
    │   └── upload.js           ← Payment proof file uploads
    └── uploads/                ← Auto-created, stores payment proof images
```

---

## Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env — change JWT_SECRET and ADMIN_PASSWORD!
```

### 3. Start the Server
```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

The server runs on **http://localhost:3000** and serves your frontend files automatically.

---

## Default Admin Credentials
- **URL:** http://localhost:3000/admin-login.html
- **Username:** `admin`
- **Password:** `CrownAdmin2024!` (change this immediately in `.env`)

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Client registration |
| POST | `/api/auth/login` | Client login |
| POST | `/api/auth/admin/login` | Admin login |
| POST | `/api/auth/referral/login` | Referral agent login |
| GET  | `/api/auth/me` | Get current user |

### Mentorship
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/mentorship/apply` | Submit mentorship application |
| GET  | `/api/mentorship/status/:email` | Check application status |

### Referral
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/referral/register` | Register as referral agent |
| GET  | `/api/referral/dashboard` | Agent dashboard data (auth required) |
| GET  | `/api/referral/check/:code` | Validate a referral code |

### Admin (all require admin token)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/admin/stats` | Dashboard statistics |
| GET  | `/api/admin/mentorship` | List mentorship applications |
| PATCH| `/api/admin/mentorship/:id` | Approve/reject application |
| GET  | `/api/admin/referral` | List referral applications |
| PATCH| `/api/admin/referral/:id` | Approve/reject referral |
| PATCH| `/api/admin/earnings/:id/pay` | Mark earnings as paid |

---

## Fixes Applied to Frontend

| File | Issue | Fix |
|------|-------|-----|
| `index.html` | CTA "Secure Your Position" linked to `register.html` (doesn't exist) | Changed to `mentorship-form.html` |
| `index.html` | Stats counter: "24" stat showed "/7 Support" as label confusingly | Moved suffix to `data-suffix` attribute, label is just "Support" |
| `index.html` | No mobile hamburger menu | Added responsive hamburger |
| `login.html` | Just a placeholder stub | Rebuilt as full login + register page |
| `mentorship-form.html` | JS truncated mid-function | Completed + wired to `/api/mentorship/apply` |
| `mentorship-form.html` | Bottom CTA button linked to itself | Changed to scroll to `#applyForm` |
| `mentorship-form.html` | `amount` hardcoded as `50000` | Removed (handled server-side as 3500) |
| `referral-register.html` | Submitted to `localStorage` only | Wired to `/api/referral/register` |
| All pages | No mobile nav | Added hamburger menu |

---

## Deployment (Render.com — Free)
1. Push everything to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your repo, set root directory to `backend/`
4. Build command: `npm install`
5. Start command: `node server.js`
6. Add environment variables from `.env`
