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

    console.log("📱 Contact sync request received:", {
      phoneCount: phoneNumbers?.length,
      samplePhones: phoneNumbers?.slice(0, 3),
    });

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res.status(400).json({
        success: false,
        message: "Phone numbers array is required",
      });
    }

    // Enhanced phone number cleaning and normalization
    const processPhoneNumbers = (phones) => {
      const processed = new Set(); // Use Set to avoid duplicates

      phones.forEach((phone) => {
        if (!phone) return;

        // Remove all non-digits
        let cleaned = phone.toString().replace(/\D/g, "");

        // Skip if too short
        if (cleaned.length < 10) return;

        // Add various formats for better matching
        if (cleaned.length === 10) {
          // US format: 1234567890
          processed.add(cleaned);
        } else if (cleaned.length === 11 && cleaned.startsWith("1")) {
          // US format with country code: 11234567890
          processed.add(cleaned);
          processed.add(cleaned.substring(1)); // Without country code
        } else if (cleaned.length === 12 && cleaned.startsWith("91")) {
          // Indian format: 919876543210
          processed.add(cleaned);
          processed.add(cleaned.substring(2)); // Without country code
        } else if (cleaned.length >= 10) {
          // Other formats
          processed.add(cleaned);
          // Also try last 10 digits
          if (cleaned.length > 10) {
            processed.add(cleaned.substring(cleaned.length - 10));
          }
        }
      });

      return Array.from(processed);
    };

    const cleanedPhones = processPhoneNumbers(phoneNumbers);

    console.log("📱 Processed phone numbers:", {
      original: phoneNumbers.length,
      processed: cleanedPhones.length,
      sampleProcessed: cleanedPhones.slice(0, 5),
    });

    if (cleanedPhones.length === 0) {
      return res.json({
        success: true,
        message: "No valid phone numbers provided",
        data: {
          foundUsers: [],
          totalFound: 0,
          searchedPhones: 0,
        },
      });
    }

    // Get all users first to do flexible matching
    const allUsers = await User.find(
      { isEmailVerified: true },
      {
        name: 1,
        _id: 1,
        avatar: 1,
        phone: 1,
        bio: 1,
      }
    );

    console.log("📱 Total verified users in database:", allUsers.length);

    // Flexible phone matching
    const matchedUsers = [];
    const processedUserPhones = new Set();

    allUsers.forEach((user) => {
      if (!user.phone || processedUserPhones.has(user._id.toString())) return;

      const userPhone = user.phone.replace(/\D/g, "");

      // Check if user's phone matches any of the contact phones
      const isMatch = cleanedPhones.some((contactPhone) => {
        // Exact match
        if (contactPhone === userPhone) return true;

        // Last 10 digits match (for different country codes)
        if (contactPhone.length >= 10 && userPhone.length >= 10) {
          const contactLast10 = contactPhone.substring(
            contactPhone.length - 10
          );
          const userLast10 = userPhone.substring(userPhone.length - 10);
          if (contactLast10 === userLast10) return true;
        }

        // Handle country code variations
        if (contactPhone.length === 10 && userPhone.length === 12) {
          // Contact: 9876543210, User: 919876543210
          if (userPhone.substring(2) === contactPhone) return true;
        }
        if (contactPhone.length === 12 && userPhone.length === 10) {
          // Contact: 919876543210, User: 9876543210
          if (contactPhone.substring(2) === userPhone) return true;
        }

        return false;
      });

      if (isMatch) {
        matchedUsers.push(user);
        processedUserPhones.add(user._id.toString());
      }
    });

    console.log("📱 Found matching users:", {
      count: matchedUsers.length,
      users: matchedUsers.map((u) => ({ name: u.name, phone: u.phone })),
    });

    // Sort by name
    matchedUsers.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      message: `Found ${matchedUsers.length} users from your contacts`,
      data: {
        foundUsers: matchedUsers,
        totalFound: matchedUsers.length,
        searchedPhones: cleanedPhones.length,
        totalContacts: phoneNumbers.length,
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

// Test endpoint to debug contact sync
router.get("/test-contacts", async (req, res) => {
  try {
    const users = await User.find(
      { isEmailVerified: true },
      { name: 1, phone: 1, email: 1 }
    ).limit(10);

    const testPhones = ["1234567890", "9876543210", "919876543210"];

    res.json({
      success: true,
      message: "Contact sync test data",
      data: {
        totalUsers: await User.countDocuments({ isEmailVerified: true }),
        sampleUsers: users,
        testPhones: testPhones,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Test contacts error:", error);
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
