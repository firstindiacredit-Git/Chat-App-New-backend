const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { generateOTP, sendOTPEmail } = require("../services/emailService");

const router = express.Router();

// Middleware for rate limiting (you can add this later)
// const rateLimit = require('express-rate-limit');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// Send OTP for login
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // Check if user exists
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please sign up first.",
      });
    }

    // Generate and save OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.findByIdAndUpdate(user._id, {
      "otp.code": otp,
      "otp.expiresAt": expiresAt,
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, "login");

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send verification code. Please try again.",
      });
    }

    res.json({
      success: true,
      message: "Verification code sent to your email",
    });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Verify OTP for login
router.post("/verify-otp-login", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    // Find user and verify OTP
    const user = await User.findOne({
      email: email.toLowerCase(),
      "otp.code": otp,
      "otp.expiresAt": { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    // Clear OTP
    await User.findByIdAndUpdate(user._id, {
      $unset: { otp: 1 },
      isEmailVerified: true,
    });

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          bio: user.bio,
          avatar: user.avatar,
          isEmailVerified: true,
        },
        token,
      },
    });
  } catch (error) {
    console.error("Verify OTP login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Signup
router.post("/signup", async (req, res) => {
  try {
    const { name, phone, bio, email } = req.body;

    // Validation
    if (!name || !phone || !email) {
      return res.status(400).json({
        success: false,
        message: "Name, phone, and email are required",
      });
    }

    if (!email.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // Phone number validation
    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(phone.trim())) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid phone number (10-15 digits)",
      });
    }

    // Check if user already exists with email or phone
    const existingUserByEmail = await User.findOne({
      email: email.toLowerCase(),
    });
    if (existingUserByEmail) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const existingUserByPhone = await User.findOne({ phone: phone.trim() });
    if (existingUserByPhone) {
      return res.status(409).json({
        success: false,
        message:
          "This phone number is already registered. Please use a different number or try logging in.",
        errorType: "PHONE_EXISTS",
      });
    }

    // Create new user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      phone: phone.trim(),
      bio: bio ? bio.trim() : "",
    });

    await user.save();

    // Generate and save OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.findByIdAndUpdate(user._id, {
      "otp.code": otp,
      "otp.expiresAt": expiresAt,
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, "signup");

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message:
          "Account created but failed to send verification code. Please try logging in.",
      });
    }

    res.json({
      success: true,
      message:
        "Account created successfully. Verification code sent to your email.",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          bio: user.bio,
        },
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Verify OTP for signup
router.post("/verify-otp-signup", async (req, res) => {
  try {
    const { email, otp, signupData } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    // Find user and verify OTP
    const user = await User.findOne({
      email: email.toLowerCase(),
      "otp.code": otp,
      "otp.expiresAt": { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    // Update user data if provided
    if (signupData) {
      await User.findByIdAndUpdate(user._id, {
        name: signupData.name || user.name,
        phone: signupData.phone || user.phone,
        bio: signupData.bio || user.bio,
        isEmailVerified: true,
        $unset: { otp: 1 },
      });
    } else {
      await User.findByIdAndUpdate(user._id, {
        isEmailVerified: true,
        $unset: { otp: 1 },
      });
    }

    // Get updated user
    const updatedUser = await User.findById(user._id);

    // Generate token
    const token = generateToken(updatedUser._id);

    res.json({
      success: true,
      message: "Email verified successfully",
      data: {
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          bio: updatedUser.bio,
          avatar: updatedUser.avatar,
          isEmailVerified: true,
        },
        token,
      },
    });
  } catch (error) {
    console.error("Verify OTP signup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Resend OTP
router.post("/resend-otp", async (req, res) => {
  try {
    const { email, type } = req.body;

    if (!email || !type) {
      return res.status(400).json({
        success: false,
        message: "Email and type are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate and save new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.findByIdAndUpdate(user._id, {
      "otp.code": otp,
      "otp.expiresAt": expiresAt,
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, type);

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to resend verification code. Please try again.",
      });
    }

    res.json({
      success: true,
      message: "Verification code resent to your email",
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get all users (for user list page)
router.get("/users", async (req, res) => {
  try {
    const users = await User.find(
      { isEmailVerified: true },
      { name: 1, _id: 1, avatar: 1, phone: 1 }
    ).sort({ createdAt: -1 });

    res.json({
      success: true,
      message: "Users retrieved successfully",
      data: {
        users,
        totalUsers: users.length,
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Find users by phone numbers (for contact sync)
router.post("/find-users-by-phones", async (req, res) => {
  try {
    const { phoneNumbers } = req.body;

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res.status(400).json({
        success: false,
        message: "Phone numbers array is required",
      });
    }

    // Clean and validate phone numbers
    const cleanedPhones = phoneNumbers
      .map((phone) => phone.replace(/\D/g, "")) // Remove non-digits
      .filter((phone) => phone.length >= 10 && phone.length <= 15); // Valid length

    if (cleanedPhones.length === 0) {
      return res.json({
        success: true,
        message: "No valid phone numbers provided",
        data: {
          foundUsers: [],
          totalFound: 0,
        },
      });
    }

    // Find users with matching phone numbers
    const foundUsers = await User.find(
      {
        phone: { $in: cleanedPhones },
        isEmailVerified: true,
      },
      {
        name: 1,
        _id: 1,
        avatar: 1,
        phone: 1,
        bio: 1,
      }
    ).sort({ name: 1 });

    res.json({
      success: true,
      message: "Users found successfully",
      data: {
        foundUsers,
        totalFound: foundUsers.length,
        searchedPhones: cleanedPhones.length,
      },
    });
  } catch (error) {
    console.error("Find users by phones error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Logout (optional - for token blacklisting)
router.post("/logout", async (req, res) => {
  try {
    // In a real app, you might want to blacklist the token
    // For now, we'll just return success
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
