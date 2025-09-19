/**
 * Firebase Cloud Messaging Service
 * Handles FCM notifications for Android app
 */

const admin = require("firebase-admin");
const User = require("../models/User");

class FCMService {
  constructor() {
    this.isInitialized = false;
    this.initializeFCM();
  }

  /**
   * Initialize Firebase Admin SDK
   */
  initializeFCM() {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length === 0) {
        // For development - using default credentials
        // In production, use proper service account key
        const serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID || "chatapp-demo",
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "demo",
          private_key:
            process.env.FIREBASE_PRIVATE_KEY ||
            "-----BEGIN PRIVATE KEY-----\nDemo Key\n-----END PRIVATE KEY-----\n",
          client_email:
            process.env.FIREBASE_CLIENT_EMAIL ||
            "firebase-adminsdk@chatapp-demo.iam.gserviceaccount.com",
          client_id: process.env.FIREBASE_CLIENT_ID || "demo",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url:
            "https://www.googleapis.com/oauth2/v1/certs",
        };

        // Initialize with service account (for production)
        if (
          process.env.FIREBASE_PRIVATE_KEY &&
          process.env.FIREBASE_PROJECT_ID
        ) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID,
          });
          console.log("📱 Firebase Admin SDK initialized with service account");
        } else {
          // For development - initialize without credentials (will use default)
          console.log(
            "📱 Firebase credentials not found - using development mode"
          );
          console.log(
            "📱 FCM notifications will be simulated via local notifications"
          );
          return;
        }
      }

      this.isInitialized = true;
      console.log("📱 FCM Service initialized successfully");
    } catch (error) {
      console.error("📱 Error initializing FCM:", error);
      this.isInitialized = false;
    }
  }

  /**
   * Save FCM token for user
   */
  async saveFCMToken(userId, fcmToken, platform = "android") {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Initialize fcmTokens array if it doesn't exist
      if (!user.fcmTokens) {
        user.fcmTokens = [];
      }

      // Check if token already exists
      const existingToken = user.fcmTokens.find(
        (token) => token.token === fcmToken
      );

      if (!existingToken) {
        user.fcmTokens.push({
          token: fcmToken,
          platform: platform,
          createdAt: new Date(),
        });
        await user.save();
        console.log(`📱 FCM token saved for user: ${user.name}`);
      }

      return true;
    } catch (error) {
      console.error("📱 Error saving FCM token:", error);
      return false;
    }
  }

  /**
   * Send FCM notification to user
   */
  async sendFCMNotification(userId, notificationData) {
    try {
      if (!this.isInitialized) {
        console.log(
          "📱 FCM not initialized - using fallback local notification"
        );
        return { success: false, message: "FCM not initialized" };
      }

      const user = await User.findById(userId).select("name fcmTokens");
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log(
          `📱 No FCM tokens found for user: ${user?.name || "Unknown"}`
        );
        return { success: false, message: "No FCM tokens found" };
      }

      const message = {
        notification: {
          title: notificationData.title,
          body: notificationData.body,
          icon: notificationData.icon || "default",
        },
        data: {
          ...notificationData.data,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
        android: {
          notification: {
            icon: "ic_launcher",
            color: "#25D366",
            sound: "default",
            priority: "high",
            visibility: "public",
          },
          priority: "high",
        },
      };

      const results = [];

      // Send to all FCM tokens for this user
      for (const tokenData of user.fcmTokens) {
        try {
          const response = await admin.messaging().send({
            ...message,
            token: tokenData.token,
          });

          results.push({ success: true, token: tokenData.token, response });
          console.log(`📱 FCM notification sent to ${user.name}:`, response);
        } catch (error) {
          console.error(
            `📱 Failed to send FCM notification to ${user.name}:`,
            error
          );

          // Remove invalid tokens
          if (
            error.code === "messaging/registration-token-not-registered" ||
            error.code === "messaging/invalid-registration-token"
          ) {
            await this.removeFCMToken(userId, tokenData.token);
          }

          results.push({
            success: false,
            token: tokenData.token,
            error: error.message,
          });
        }
      }

      return { success: true, results };
    } catch (error) {
      console.error("📱 Error sending FCM notification:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove FCM token
   */
  async removeFCMToken(userId, fcmToken) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.fcmTokens) {
        return false;
      }

      user.fcmTokens = user.fcmTokens.filter(
        (token) => token.token !== fcmToken
      );
      await user.save();

      console.log(`📱 FCM token removed for user: ${user.name}`);
      return true;
    } catch (error) {
      console.error("📱 Error removing FCM token:", error);
      return false;
    }
  }

  /**
   * Send message notification
   */
  async sendMessageNotification(
    receiverId,
    senderName,
    messageContent,
    chatId
  ) {
    const notificationData = {
      title: senderName,
      body:
        messageContent.length > 100
          ? messageContent.substring(0, 100) + "..."
          : messageContent,
      icon: "ic_launcher",
      data: {
        type: "message",
        chatId: chatId,
        senderName: senderName,
        timestamp: Date.now().toString(),
      },
    };

    return await this.sendFCMNotification(receiverId, notificationData);
  }

  /**
   * Send call notification
   */
  async sendCallNotification(
    receiverId,
    callerName,
    callType = "voice",
    callId
  ) {
    const notificationData = {
      title: `Incoming ${callType} call`,
      body: `${callerName} is calling you`,
      icon: "ic_launcher",
      data: {
        type: "call",
        callId: callId,
        callerName: callerName,
        callType: callType,
        timestamp: Date.now().toString(),
      },
    };

    return await this.sendFCMNotification(receiverId, notificationData);
  }

  /**
   * Send system notification
   */
  async sendSystemNotification(
    receiverId,
    title,
    message,
    type = "info",
    data = {}
  ) {
    const notificationData = {
      title: title,
      body: message,
      icon: "ic_launcher",
      data: {
        type: "system",
        category: type,
        message: message,
        timestamp: Date.now().toString(),
        ...data,
      },
    };

    return await this.sendFCMNotification(receiverId, notificationData);
  }

  /**
   * Handle notification click
   */
  handleNotificationClick(data) {
    console.log("📱 FCM notification clicked:", data);

    // Navigate based on notification type
    switch (data.type) {
      case "message":
        // Navigate to chat
        window.dispatchEvent(
          new CustomEvent("navigateToChat", {
            detail: { chatId: data.chatId },
          })
        );
        break;

      case "call":
        // Handle incoming call
        window.dispatchEvent(
          new CustomEvent("incomingCall", {
            detail: {
              callerName: data.callerName,
              callType: data.callType,
              callId: data.callId,
            },
          })
        );
        break;

      case "system":
        // Just open app for system notifications
        console.log("📱 System notification clicked");
        break;
    }
  }

  /**
   * Get authentication token
   */
  getAuthToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("authToken") ||
      sessionStorage.getItem("token") ||
      sessionStorage.getItem("authToken")
    );
  }

  /**
   * Check if service is available
   */
  isAvailable() {
    return this.isNative && this.isAndroid;
  }
}

// Create singleton instance
const fcmService = new FCMService();

module.exports = fcmService;
