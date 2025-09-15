const fs = require("fs");
const path = require("path");

// Environment configuration
const envConfig = `# Server Configuration
PORT=5000
NODE_ENV=development
JWT_SECRET=your_jwt_secret_key_here_change_in_production

# Email Configuration (Gmail)
EMAIL_USER=pizeonflyn@gmail.com
EMAIL_PASSWORD=pykyjxnlzvqlzrfp

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Database (MongoDB)
MONGODB_URI=mongodb://localhost:27017/chatapp

# Cloudinary (for future image uploads)
CLOUDINARY_CLOUD_NAME=dnjcel8gn
CLOUDINARY_API_KEY=531611112764376
CLOUDINARY_API_SECRET=I69N62Vr-vrohe6tGfYI0276EJA
`;

// Write .env file
fs.writeFileSync(path.join(__dirname, ".env"), envConfig);
console.log("✅ .env file created successfully");

// Generate a random JWT secret
const crypto = require("crypto");
const jwtSecret = crypto.randomBytes(64).toString("hex");
const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const updatedEnv = envContent.replace(
  "your_jwt_secret_key_here_change_in_production",
  jwtSecret
);
fs.writeFileSync(path.join(__dirname, ".env"), updatedEnv);
console.log("✅ JWT secret generated");

console.log("🚀 Backend setup complete!");
console.log("📧 Email configured with: pizeonflyn@gmail.com");
console.log("💾 Database: MongoDB (make sure MongoDB is running)");
console.log("🌐 Frontend URL: http://localhost:3000");
console.log("");
console.log("Next steps:");
console.log("1. Run: npm install");
console.log("2. Make sure MongoDB is running");
console.log("3. Run: npm run dev");
