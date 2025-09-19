const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const avatarRoutes = require("./routes/avatar");
const messageRoutes = require("./routes/messages");
const groupRoutes = require("./routes/groups");
const callRoutes = require("./routes/calls");
const uploadRoutes = require("./routes/upload");
const usersRoutes = require("./routes/users");
const searchRoutes = require("./routes/search");
const friendsRoutes = require("./routes/friends");
const postsRoutes = require("./routes/posts");
const { router: storyRoutes, setSocketIO } = require("./routes/stories");
const { initializeSocket } = require("./socket/socketServer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://chat-app-new-frontend.vercel.app",
      process.env.FRONTEND_URL,
      // Mobile app origins
      "capacitor://localhost",
      "ionic://localhost",
      "http://localhost",
      "https://localhost",
    ].filter(Boolean),
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowEIO3: true,
});

const PORT = process.env.PORT || 8000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://chat-app-new-frontend.vercel.app",
      process.env.FRONTEND_URL,
      // Mobile app origins
      "capacitor://localhost",
      "ionic://localhost",
      "http://localhost",
      "https://localhost",
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "Cache-Control",
      "X-Access-Token",
    ],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Additional CORS headers for preflight requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Access-Token"
  );

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  next();
});

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/avatar", avatarRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/stories", storyRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ChatApp Backend is running",
    timestamp: new Date().toISOString(),
  });
});

// CORS test endpoint
app.get("/api/cors-test", (req, res) => {
  res.json({
    success: true,
    message: "CORS is working correctly",
    origin: req.headers.origin,
    userAgent: req.headers["user-agent"],
    timestamp: new Date().toISOString(),
  });
});

// Preflight test endpoint
app.options("/api/cors-test", (req, res) => {
  res.status(200).json({ message: "Preflight OK" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI =
      process.env.MONGODB_URI || "mongodb://localhost:27017/chatapp";
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Initialize Socket.IO
initializeSocket(io);

// Set Socket.IO instance for story routes
setSocketIO(io);

// Make io instance available to all routes
app.set("io", io);

// Start server
const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔌 Socket.IO server initialized`);
      console.log(
        `📧 Email service configured with: ${process.env.EMAIL_USER}`
      );
      console.log(
        `🌐 Frontend URL: ${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }`
      );
    });
  } catch (error) {
    console.error("❌ Server startup error:", error);
    process.exit(1);
  }
};

startServer();
