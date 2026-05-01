// DEBUG_AUTH.md - Authentication Troubleshooting Guide

## Issue Summary
API calls are returning 401 (Unauthorized) errors after deployment.

## Root Causes Fixed
1. ✅ **Build Error** - Removed orphaned code from App.jsx (commit bcab322)
2. ✅ **JWT_SECRET Mismatch** - Added JWT_SECRET fallback to middleware/auth.js (commit 168bd8a)
   - Previous: middleware used `process.env.JWT_SECRET` (undefined if not set)
   - Now: Both auth.js and middleware/auth.js use same fallback: `'powerpulsepro-fallback-secret-change-in-production'`

## How to Verify Authentication is Working

### 1. Test Login via Browser Console
Open browser DevTools (F12) and paste:
```javascript
// Test consumer login
async function testLogin() {
  const response = await fetch('https://powerpulseproo-backend.onrender.com/api/auth/consumer/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consumerNumber: '12345', // Use valid consumer number
      password: 'password123'  // Use valid password
    })
  });
  
  const data = await response.json();
  console.log('Login Response:', data);
  
  if (data.data?.token) {
    const token = data.data.token;
    console.log('Token:', token.substring(0, 30) + '...');
    
    // Test profile endpoint
    const profileRes = await fetch('https://powerpulseproo-backend.onrender.com/api/consumer/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const profile = await profileRes.json();
    console.log('Profile Response:', profile);
  }
}

testLogin();
```

### 2. Check localStorage After Login
After logging in through the app, open DevTools console and check:
```javascript
console.log('Token in localStorage:', localStorage.getItem('consumerToken'));
console.log('Profile in localStorage:', localStorage.getItem('consumerProfile'));
```

### 3. Verify Token Format
The token should start with `eyJ` (base64 for `{"alg"...`).
If it's missing or shows "null" as a string, the token wasn't stored correctly.

### 4. Check Network Requests
In DevTools Network tab:
- Filter by `/api/consumer/`
- Click on a request to `profile` or `billing/history`
- Check **Request Headers**:
  - Should have: `Authorization: Bearer eyJ...`
  - If missing: Interceptor isn't working
- Check **Response**:
  - 401 errors should show in response body

### 5. Test Deployment Backend
Check if backend is running and accessible:
```bash
curl https://powerpulseproo-backend.onrender.com/api/health
```
Should return: `{"status":"ok"}` or similar

## Environment Variables to Verify

On Render backend settings, confirm these are set:
- `JWT_SECRET=<your-strong-secret>` (or will use fallback)
- `JWT_EXPIRES_IN=7d`
- `MONGODB_URI=<valid-mongodb-connection>`
- `NODE_ENV=production`

## Common 401 Error Causes

| Message | Cause | Solution |
|---------|-------|----------|
| "Access token is required" | No Authorization header | Check if token is in localStorage and interceptor is running |
| "Invalid token" | JWT verification failed | JWT_SECRET mismatch (should be fixed now) |
| "Token has expired" | exp claim is in the past | Login again to get fresh token |
| "Invalid token or inactive account" | User not found or status != 'active' | Verify consumer exists in database and is active |
| "Invalid token type" | type field missing or wrong | Verify token payload includes `type: 'consumer'` |

## What the JWT_SECRET Fix Does

**Before (Broken):**
```javascript
// auth.js
const JWT_SECRET = process.env.JWT_SECRET || 'fallback';  // Signs token
```
```javascript
// middleware/auth.js
const decoded = jwt.verify(token, process.env.JWT_SECRET);  // Verifies with undefined!
```
Result: Tokens signed with fallback but verified with undefined = 401 errors

**After (Fixed):**
```javascript
// auth.js  
const JWT_SECRET = process.env.JWT_SECRET || 'fallback';  // Signs token
```
```javascript
// middleware/auth.js
const JWT_SECRET = process.env.JWT_SECRET || 'fallback';  // Verifies with same fallback
```
Result: Tokens signed and verified with same secret = 200 OK

## Next Steps If Still Getting 401

1. Check MongoDB connection is working
2. Verify a consumer user actually exists in the database with status='active'
3. Check Render deployment logs for any error messages
4. Try logging in again after the fix deploys
5. Clear browser cache/localStorage and try fresh login

## Production Recommendation

Set `JWT_SECRET` environment variable on Render to a strong, random secret instead of relying on fallback:
```
JWT_SECRET=your-256-bit-random-secret-here-change-this
```

This prevents any potential token verification issues in production.
