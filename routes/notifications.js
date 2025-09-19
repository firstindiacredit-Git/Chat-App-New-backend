const express = require("express");
const notificationService = require("../services/notificationService");
const fcmService = require("../services/fcmService");
const User = require("../models/User");

const router = express.Router();

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid token. User not found.",
      });
    }

    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

// Get VAPID public key
router.get("/vapid-public-key", (req, res) => {
  try {
    const publicKey = notificationService.getVapidPublicKey();
    res.json({
      success: true,
      data: {
        publicKey: publicKey,
      },
    });
  } catch (error) {
    console.error("Get VAPID public key error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Subscribe to push notifications
router.post("/subscribe", verifyToken, async (req, res) => {
  try {
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription data",
      });
    }

    const success = await notificationService.saveSubscription(
      req.userId,
      subscription
    );

    if (success) {
      res.json({
        success: true,
        message: "Push notification subscription saved successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to save push notification subscription",
      });
    }
  } catch (error) {
    console.error("Subscribe to push notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Unsubscribe from push notifications
router.post("/unsubscribe", verifyToken, async (req, res) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: "Endpoint is required",
      });
    }

    const success = await notificationService.removeSubscription(
      req.userId,
      endpoint
    );

    if (success) {
      res.json({
        success: true,
        message: "Push notification subscription removed successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to remove push notification subscription",
      });
    }
  } catch (error) {
    console.error("Unsubscribe from push notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Send test notification (for development/admin)
router.post("/test", verifyToken, async (req, res) => {
  try {
    const { title, body, type = "test" } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "Title and body are required",
      });
    }

    const result = await notificationService.sendSystemNotification(
      req.userId,
      title,
      body,
      type
    );

    res.json({
      success: true,
      message: "Test notification sent",
      data: result,
    });
  } catch (error) {
    console.error("Send test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get notification statistics (admin only)
router.get("/stats", verifyToken, async (req, res) => {
  try {
    // Basic admin check - you can implement proper admin role checking
    if (req.user.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin only.",
      });
    }

    const stats = await notificationService.getNotificationStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get notification stats error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get user's push subscriptions
router.get("/subscriptions", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("pushSubscriptions");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const subscriptions = user.pushSubscriptions || [];

    res.json({
      success: true,
      data: {
        subscriptions: subscriptions.map((sub) => ({
          endpoint: sub.endpoint,
          createdAt: sub.createdAt,
        })),
        totalSubscriptions: subscriptions.length,
      },
    });
  } catch (error) {
    console.error("Get user subscriptions error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Subscribe to FCM notifications (for Android app)
router.post("/fcm-subscribe", verifyToken, async (req, res) => {
  try {
    const { fcmToken, platform = "android" } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required",
      });
    }

    const success = await fcmService.saveFCMToken(
      req.userId,
      fcmToken,
      platform
    );

    if (success) {
      res.json({
        success: true,
        message: "FCM token saved successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to save FCM token",
      });
    }
  } catch (error) {
    console.error("FCM subscribe error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Send FCM test notification
router.post("/fcm-test", verifyToken, async (req, res) => {
  try {
    const { title, body, type = "test" } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "Title and body are required",
      });
    }

    const result = await fcmService.sendSystemNotification(
      req.userId,
      title,
      body,
      type
    );

    res.json({
      success: true,
      message: "FCM test notification sent",
      data: result,
    });
  } catch (error) {
    console.error("FCM test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
