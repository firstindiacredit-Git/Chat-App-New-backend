# Server Restart Instructions

## Contact Sync Fix - Server Restart Required

The contact sync functionality has been enhanced with new endpoints and improved matching logic. **Server restart is required** for the changes to take effect.

### Changes Made:
1. **Enhanced phone number matching** in `/auth/find-users-by-phones`
2. **New debug endpoint** `/auth/test-contacts`
3. **Improved logging** for debugging
4. **Better error handling**

### To Restart Server:

#### Option 1: Using npm
```bash
cd Backend
npm start
```

#### Option 2: Using PM2 (if deployed)
```bash
pm2 restart all
# or specific app
pm2 restart chat-backend
```

#### Option 3: Using Docker (if containerized)
```bash
docker-compose restart backend
```

### Verify Server is Running:
1. Check console logs for startup messages
2. Test endpoint: `GET /api/auth/test-contacts`
3. Test main endpoint: `POST /api/auth/find-users-by-phones`

### Expected Behavior After Restart:
- ✅ `/api/auth/test-contacts` should return 200 (not 404)
- ✅ Contact sync should work with better phone matching
- ✅ Detailed logs should appear in console
- ✅ Debug button should work in development mode

### If Still Getting 404:
1. Check if routes are properly imported in `server.js`
2. Verify `app.use("/api/auth", authRoutes)` is present
3. Check for any syntax errors in `auth.js`
4. Ensure server restarted completely (not just reloaded)

### Testing Without Server Restart:
You can still test the main contact sync functionality using:
1. **Manual Entry Mode** in ContactSync component
2. **"Use Test Numbers" button** to populate sample data
3. **Main sync endpoint** which should work even without the debug endpoint

---
**Note**: The 404 error for `/auth/test-contacts` indicates the server needs to be restarted to load the new route definitions.
