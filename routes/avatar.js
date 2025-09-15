const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { uploadImage, deleteImage } = require("../services/cloudinaryService");

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

// Upload avatar
router.post(
  "/upload",
  verifyToken,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image file provided",
        });
      }

      // Upload to Cloudinary
      const uploadResult = await uploadImage(req.file.buffer);

      if (!uploadResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to upload image",
          error: uploadResult.error,
        });
      }

      // Find user and get old avatar
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Delete old avatar from Cloudinary if it exists
      if (user.avatar && user.avatar.includes("cloudinary.com")) {
        // Extract public_id from Cloudinary URL
        const urlParts = user.avatar.split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = publicIdWithExtension.split(".")[0];
        await deleteImage(publicId);
      }

      // Update user avatar in database
      user.avatar = uploadResult.url;
      await user.save();

      res.json({
        success: true,
        message: "Avatar updated successfully",
        data: {
          avatar: uploadResult.url,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            bio: user.bio,
            avatar: user.avatar,
            isEmailVerified: user.isEmailVerified,
          },
        },
      });
    } catch (error) {
      console.error("Avatar upload error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Delete avatar (reset to default)
router.delete("/delete", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Delete old avatar from Cloudinary if it exists
    if (user.avatar && user.avatar.includes("cloudinary.com")) {
      // Extract public_id from Cloudinary URL
      const urlParts = user.avatar.split("/");
      const publicIdWithExtension = urlParts[urlParts.length - 1];
      const publicId = publicIdWithExtension.split(".")[0];
      await deleteImage(publicId);
    }

    // Remove avatar from database
    user.avatar = "";
    await user.save();

    res.json({
      success: true,
      message: "Avatar deleted successfully",
      data: {
        avatar: "",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          bio: user.bio,
          avatar: user.avatar,
          isEmailVerified: user.isEmailVerified,
        },
      },
    });
  } catch (error) {
    console.error("Avatar delete error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
