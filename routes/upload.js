const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const router = express.Router();

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.header("Authorization");
  console.log("🔑 Upload auth header:", authHeader);

  const token = authHeader?.replace("Bearer ", "");
  console.log("🔑 Upload token:", token ? "Token exists" : "No token");

  if (!token) {
    console.log("❌ No token provided for upload");
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  try {
    console.log("🔑 Verifying token for upload...");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ Token verified for user:", decoded.userId);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.log("❌ Token verification failed:", error.message);
    res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

// Configure multer for file uploads - preserve original file quality
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/messages");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve original filename with timestamp for uniqueness
    const timestamp = Date.now();
    const originalName = path.parse(file.originalname).name;
    const extension = path.extname(file.originalname);
    const uniqueFilename = `${originalName}-${timestamp}${extension}`;
    cb(null, uniqueFilename);
  },
});

// File filter to validate file types
const fileFilter = (req, file, cb) => {
  const allowedMimes = {
    // Images
    "image/jpeg": true,
    "image/jpg": true,
    "image/png": true,
    "image/gif": true,
    "image/webp": true,
    // Videos
    "video/mp4": true,
    "video/avi": true,
    "video/mov": true,
    "video/wmv": true,
    "video/flv": true,
    "video/webm": true,
    "video/mkv": true,
    // Documents
    "application/pdf": true,
    "application/msword": true,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
    "application/vnd.ms-excel": true,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
    "application/vnd.ms-powerpoint": true,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
    "text/plain": true,
    "text/csv": true,
    // Archives
    "application/zip": true,
    "application/x-rar-compressed": true,
    "application/x-7z-compressed": true,
  };

  if (allowedMimes[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for high quality images
  },
  preservePath: true, // Preserve original file path
});

// Helper function to get file type category
const getFileTypeCategory = (mimeType) => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
};

// Upload file route
router.post("/file", verifyToken, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const file = req.file;
    const fileTypeCategory = getFileTypeCategory(file.mimetype);

    console.log("📁 File uploaded locally:", {
      filePath: file.path,
      fileType: fileTypeCategory,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      encoding: file.encoding,
      fieldname: file.fieldname,
    });

    // Verify file integrity
    const stats = fs.statSync(file.path);
    console.log("📊 File stats:", {
      size: stats.size,
      isFile: stats.isFile(),
      mtime: stats.mtime,
    });

    // Prepare response data - using local file URL
    const fileData = {
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: `/api/upload/file/${file.filename}`, // Local file URL
      thumbnail:
        fileTypeCategory === "image"
          ? `/api/upload/file/${file.filename}`
          : null,
      type: fileTypeCategory,
      localPath: file.path, // Store local path for reference
    };

    console.log("📎 Final file data:", fileData);

    res.json({
      success: true,
      message: "File uploaded successfully",
      data: fileData,
    });
  } catch (error) {
    console.error("❌ File upload error:", error);

    // Clean up file if it exists
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting file after error:", err);
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "File upload failed",
    });
  }
});

// Get file info route (for serving files)
router.get("/file/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "../uploads/messages", filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error("File serve error:", error);
    res.status(500).json({
      success: false,
      message: "Error serving file",
    });
  }
});

module.exports = router;
