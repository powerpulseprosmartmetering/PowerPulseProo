# PowerPulsePro - Quick Deployment & Testing Guide

## Deployment Steps

### 1. Backend Deployment (Render.com or similar)

```bash
# 1. Set Environment Variables on platform:
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/powerpulsepro
JWT_SECRET=<generate-strong-random-string>
JWT_EXPIRES_IN=7d
NODE_ENV=production
PORT=5000
CLIENT_URL=https://your-frontend-domain.com
BCRYPT_SALT_ROUNDS=12

# 2. Push code
git add .
git commit -m "Apply comprehensive auth and routing fixes"
git push

# 3. Platform auto-deploys
# Verify: GET https://your-backend-url/api/health
# Should return: {"status":"success","message":"PowerPulsePro API is running!",...}
```

### 2. Frontend Deployment (Vercel, Netlify, or similar)

```bash
# 1. Build
npm run build

# 2. Deploy build folder
# Platform will auto-redirect /api calls based on:
# - Production: https://your-backend-domain
# - Development: http://localhost:5000

# 3. Verify:
# - Can reach login page
# - Can reach /api/health (via backend)
```

---

## Quick Testing

### Test 1: Consumer Login Works

```bash
# 1. Get default consumer from DB or create one
# In MongoDB:
db.consumers.findOne()
# Note: consumerNumber, password (it's hashed, so create via app)

# 2. Call login API
curl -X POST http://localhost:5000/api/auth/consumer/login \
  -H "Content-Type: application/json" \
  -d '{
    "consumerNumber": "CONS001",
    "password": "password123"
  }'

# 3. Should get response with token
# Copy token value

# 4. Test with token
curl -X GET http://localhost:5000/api/consumer/profile \
  -H "Authorization: Bearer <paste_token_here>"

# 5. Should see consumer profile (200 OK)
```

### Test 2: Admin Login Works

```bash
# Default admin is seeded: ADM0001 / Admin@12345
curl -X POST http://localhost:5000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "adminId": "ADM0001",
    "password": "Admin@12345"
  }'

# Copy token and test
curl -X GET http://localhost:5000/api/admin/consumers \
  -H "Authorization: Bearer <token>"

# Should see list of consumers
```

### Test 3: Token Expiration

```bash
# 1. Login and get token
# 2. Wait 7 days (or set JWT_EXPIRES_IN=1s for testing)
# 3. Try to use token
curl -X GET http://localhost:5000/api/consumer/profile \
  -H "Authorization: Bearer <expired_token>"

# Should return 401: "Token has expired"
```

### Test 4: Frontend Token Storage

```javascript
// In browser console after login:
localStorage.getItem('consumerToken')  // Should be valid token
localStorage.getItem('adminToken')     // Should be null
localStorage.getItem('token')          // Should be null (cleaned up)
localStorage.getItem('consumerProfile') // Should be JSON

// After admin logout and admin login:
localStorage.getItem('adminToken')    // Should be valid token
localStorage.getItem('consumerToken') // Should be null (cleaned up)
```

### Test 5: Protected Routes

```javascript
// 1. Open browser DevTools -> Network
// 2. Login as consumer
// 3. Navigate to /bills
// 4. In Network tab, check API calls:
//    - Should see Authorization: Bearer <token> header
//    - Should NOT see 401 errors
//    - Response should have bills data

// 5. Refresh page
// 6. Should still have access (token persisted in localStorage)

// 7. Open DevTools -> Application -> Storage -> Clear All
// 8. Refresh - should redirect to login
```

### Test 6: Billing History API

```bash
# After consumer login:
curl -X GET "http://localhost:5000/api/consumer/billing/history?limit=12&month=2026-05" \
  -H "Authorization: Bearer <consumer_token>"

# Should return:
{
  "status": "success",
  "data": {
    "bills": [...],
    "pagination": {...}
  }
}
```

---

## Common Issues & Debug Steps

### Issue: "Unable to connect to server"

**Debug:**
```bash
# 1. Check backend is running
curl http://localhost:5000/api/health

# 2. If running on different port, check:
# Frontend at: http://localhost:5173
# Backend at: http://localhost:5000

# 3. Check CORS settings
# Backend should have CLIENT_URL set

# 4. Check if firewall blocking port
# On Windows: netstat -ano | findstr :5000
# On Mac/Linux: lsof -i :5000
```

### Issue: "401 Unauthorized" on protected routes

**Debug:**
```bash
# 1. Check token is valid
# In console: localStorage.getItem('consumerToken')

# 2. Verify token structure
# Paste token at https://jwt.io/

# 3. Check Authorization header
# DevTools -> Network -> Click API call -> Headers
# Should see: Authorization: Bearer <token>

# 4. Verify backend JWT_SECRET matches
# Token was signed with: process.env.JWT_SECRET
```

### Issue: "No billing records found"

**Debug:**
```bash
# 1. Check consumer is active
db.consumers.findOne({email: "consumer@example.com"})
# status should be 'active'

# 2. Check consumer has meter readings
db.meterreadings.findOne({consumerId: ObjectId("...")})

# 3. Try API directly
curl -X GET "http://localhost:5000/api/consumer/billing/history" \
  -H "Authorization: Bearer <token>"

# 4. Check response error message
```

### Issue: Token not persisting after refresh

**Debug:**
```javascript
// Check localStorage isn't cleared
localStorage.length > 0 // should be true

// Check browser settings
// Settings -> Privacy -> Clear cookies/cache on close

// Check for errors on page load
// DevTools -> Console

// Try incognito mode (no extensions interfering)
```

---

## File Changes Summary

| File | Change | Impact |
|------|--------|--------|
| `server/index.js` | Clean MongoDB URI | Proper DB connection |
| `server/routes/auth.js` | Standardized token payload | Consistent auth |
| `client/src/services/api.js` | Complete rewrite with interceptors | Auto auth headers |
| `client/src/components/ConsumerLogin.jsx` | Use new API & token functions | Proper token storage |
| `client/src/components/AdminLogin.jsx` | Use new API & token functions | Proper token storage |
| `client/src/App.jsx` | Updated protected routes | Type-safe routing |
| `client/src/components/BillsPage.jsx` | Use consumerAPI | Proper auth on bills |

---

## Environment Variables Checklist

### Required for Backend:
- [ ] `MONGODB_URI` - Set correctly
- [ ] `JWT_SECRET` - Strong random string
- [ ] `JWT_EXPIRES_IN` - E.g., "7d"
- [ ] `NODE_ENV` - "production"
- [ ] `PORT` - 5000 or configured port
- [ ] `CLIENT_URL` - Frontend domain
- [ ] `BCRYPT_SALT_ROUNDS` - 12

### Optional Frontend:
- [ ] `VITE_API_BASE_URL` - Can auto-detect if not set

---

## Production Security Checklist

- [ ] JWT_SECRET is strong (>32 chars, random)
- [ ] No default admin password in production
- [ ] HTTPS enabled on both frontend and backend
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] MongoDB connection secured (username/password)
- [ ] No console.logs with sensitive data in production
- [ ] Input validation on all endpoints
- [ ] Password hashing enabled (BCRYPT_SALT_ROUNDS=12)

---

## Rollback Plan

If issues occur after deployment:

```bash
# 1. Identify the problem
# Check error logs and user reports

# 2. Revert changes
git revert <commit-hash>
git push

# 3. Platform auto-redeploys
# Wait for deployment to complete

# 4. Verify rollback worked
curl https://your-backend-url/api/health

# 5. Investigate root cause
# Check MongoDB
# Check JWT_SECRET
# Check network connectivity
```

---

## Performance Optimization

1. **Frontend:**
   - Enable gzip compression
   - Minimize bundle size
   - Cache static assets
   - Use CDN for images

2. **Backend:**
   - Enable database indexes
   - Use connection pooling
   - Cache frequently accessed data
   - Monitor query performance

3. **Network:**
   - Use HTTP/2
   - Enable CORS caching headers
   - Minimize request size
   - Use pagination (default: 10-12 items)

---

## Monitoring

### Logs to Monitor:

```
[Backend]
- 401 errors (token issues)
- 403 errors (permission issues)
- 5xx errors (server issues)
- Slow queries (>1s)
- MongoDB connection errors

[Frontend]
- Network errors
- Failed API calls
- 401/403 responses
- Token expiration events
```

### Health Checks:

```bash
# Every 5 minutes
GET https://backend-url/api/health

# Every hour
GET https://backend-url/api/admin/dashboard/stats
  Header: Authorization: Bearer <admin-token>
```

---

## Support Contacts

- Backend Issues: Check logs in `console.log`
- Database Issues: Check MongoDB Atlas
- Deployment Issues: Check platform (Render, Vercel) logs
- JWT Issues: Verify token at jwt.io

---

## Success Criteria

After deployment, you should see:

✅ Consumer login works (token returned)
✅ Admin login works (token returned)  
✅ Billing history loads without errors
✅ No 401 errors on valid tokens
✅ 401 errors only on expired/invalid tokens
✅ Protected routes redirect to login when needed
✅ Token persists after page refresh
✅ Logout clears token properly
✅ API responses are consistent
✅ Error messages are helpful

---

**All systems should now be production-ready! 🚀**
