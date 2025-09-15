# ChatApp Backend API

Backend API for the ChatApp with email verification using Gmail SMTP.

## Features

- **Email Authentication**: Send OTP via Gmail for login/signup
- **User Management**: Create and manage user accounts
- **JWT Authentication**: Secure token-based authentication
- **MongoDB Integration**: User data storage
- **Rate Limiting**: API protection (ready to implement)

## Setup

### Prerequisites

- Node.js (version 14 or higher)
- MongoDB (local or cloud)
- Gmail account with App Password

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file with your configuration:
```env
# Server Configuration
PORT=5000
NODE_ENV=development
JWT_SECRET=your_jwt_secret_key_here_change_in_production

# Email Configuration (Gmail)
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Database (MongoDB)
MONGODB_URI=mongodb://localhost:27017/chatapp

# Cloudinary (for future image uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

3. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## Gmail Setup

1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail"
3. Use the App Password in your `.env` file

## API Endpoints

### Authentication

#### Send OTP for Login
```
POST /api/auth/send-otp
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Verify OTP for Login
```
POST /api/auth/verify-otp-login
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

#### Signup
```
POST /api/auth/signup
Content-Type: application/json

{
  "name": "John Doe",
  "phone": "1234567890",
  "bio": "Software Developer",
  "email": "user@example.com"
}
```

#### Verify OTP for Signup
```
POST /api/auth/verify-otp-signup
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "signupData": {
    "name": "John Doe",
    "phone": "1234567890",
    "bio": "Software Developer"
  }
}
```

#### Resend OTP
```
POST /api/auth/resend-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "type": "login" // or "signup"
}
```

#### Logout
```
POST /api/auth/logout
Authorization: Bearer <token>
```

### Health Check
```
GET /api/health
```

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    // Response data
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description"
}
```

## Database Schema

### User Model
```javascript
{
  name: String (required),
  email: String (required, unique),
  phone: String (required),
  bio: String (optional),
  isEmailVerified: Boolean (default: false),
  otp: {
    code: String,
    expiresAt: Date
  },
  resetToken: {
    token: String,
    expiresAt: Date
  },
  createdAt: Date,
  updatedAt: Date
}
```

## Security Features

- **JWT Tokens**: Secure authentication
- **OTP Expiration**: 10-minute expiry for OTP codes
- **Email Validation**: Server-side email format validation
- **CORS Protection**: Configured for frontend domain
- **Input Sanitization**: Request validation and sanitization

## Error Handling

The API includes comprehensive error handling:
- Validation errors (400)
- Authentication errors (401)
- Not found errors (404)
- Server errors (500)

## Logging

- Request logging with timestamps
- Email service debugging
- Error logging with details

## Future Enhancements

- Rate limiting for API endpoints
- Password reset functionality
- User profile image uploads
- Real-time messaging with Socket.io
- Push notifications
- Message encryption
