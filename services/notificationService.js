/**
 * Backend Notification Service
 * Handles server-side push notifications
 */

const webpush = require("web-push");
const User = require("../models/User");

class NotificationService {
  constructor() {
    // Configure web-push with VAPID keys
    // In production, these should be environment variables
    const vapidKeys = {
      publicKey:
        process.env.VAPID_PUBLIC_KEY ||
        "BBPTJdTPqaCV8QOh_IVPrD8NX_wUzqB6y22jdgta1_ASLtK4EsC-GKjm1zyVKWf_BOUlQAqNTcKQK91lCpo00GE",
      privateKey:
        process.env.VAPID_PRIVATE_KEY ||
        "kQQJLsBDAQQnEzPIh94c5S4bsZ2WyFSK5VXR8oO81zc",
    };

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:firsindiacredit786@gmail.com",
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );

    this.vapidPublicKey = vapidKeys.publicKey;
  }

  /**
   * Get VAPID public key for client subscription
   */
  getVapidPublicKey() {
    return this.vapidPublicKey;
  }

  /**
   * Save push subscription for a user
   */
  async saveSubscription(userId, subscription) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Initialize pushSubscriptions array if it doesn't exist
      if (!user.pushSubscriptions) {
        user.pushSubscriptions = [];
      }

      // Check if subscription already exists
      const existingSubscription = user.pushSubscriptions.find(
        (sub) => sub.endpoint === subscription.endpoint
      );

      if (!existingSubscription) {
        user.pushSubscriptions.push({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          createdAt: new Date(),
        });
        await user.save();
        console.log(`📱 Push subscription saved for user: ${user.name}`);
      }

      return true;
    } catch (error) {
      console.error("Error saving push subscription:", error);
      return false;
    }
  }

  /**
   * Remove push subscription for a user
   */
  async removeSubscription(userId, endpoint) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.pushSubscriptions) {
        return false;
      }

      user.pushSubscriptions = user.pushSubscriptions.filter(
        (sub) => sub.endpoint !== endpoint
      );
      await user.save();

      console.log(`📱 Push subscription removed for user: ${user.name}`);
      return true;
    } catch (error) {
      console.error("Error removing push subscription:", error);
      return false;
    }
  }

  /**
   * Send push notification to a specific user
   */
  async sendNotificationToUser(userId, notificationPayload) {
    try {
      const user = await User.findById(userId).select("name pushSubscriptions");
      if (
        !user ||
        !user.pushSubscriptions ||
        user.pushSubscriptions.length === 0
      ) {
        console.log(
          `📱 No push subscriptions found for user: ${user?.name || "Unknown"}`
        );
        return { success: false, message: "No subscriptions found" };
      }

      const payload = JSON.stringify({
        title: notificationPayload.title,
        body: notificationPayload.body,
        icon: notificationPayload.icon || "/vite.svg",
        badge: notificationPayload.badge || "/vite.svg",
        tag: notificationPayload.tag || "default",
        data: notificationPayload.data || {},
        requireInteraction: notificationPayload.requireInteraction || false,
        actions: notificationPayload.actions || [],
      });

      const results = [];

      // Send to all subscriptions for this user
      for (const subscription of user.pushSubscriptions) {
        try {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          };

          const result = await webpush.sendNotification(
            pushSubscription,
            payload
          );
          results.push({ success: true, endpoint: subscription.endpoint });
          console.log(
            `📱 Push notification sent to ${user.name}:`,
            result.statusCode
          );
        } catch (error) {
          console.error(
            `📱 Failed to send push notification to ${user.name}:`,
            error
          );

          // If subscription is invalid, remove it
          if (error.statusCode === 410 || error.statusCode === 404) {
            await this.removeSubscription(userId, subscription.endpoint);
          }

          results.push({
            success: false,
            endpoint: subscription.endpoint,
            error: error.message,
          });
        }
      }

      return { success: true, results };
    } catch (error) {
      console.error("Error sending push notification:", error);
      return { success: false, error: error.message };
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
    const payload = {
      title: senderName,
      body:
        messageContent.length > 100
          ? messageContent.substring(0, 100) + "..."
          : messageContent,
      icon: "/vite.svg",
      tag: `message-${chatId}`,
      data: {
        type: "message",
        chatId: chatId,
        senderId: receiverId, // This will be used for navigation
        senderName: senderName,
        timestamp: Date.now(),
      },
      requireInteraction: false,
    };

    return await this.sendNotificationToUser(receiverId, payload);
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
    const payload = {
      title: `Incoming ${callType} call`,
      body: `${callerName} is calling you`,
      icon: "/vite.svg",
      tag: "incoming-call",
      data: {
        type: "call",
        callId: callId,
        callerName: callerName,
        callType: callType,
        timestamp: Date.now(),
      },
      requireInteraction: true,
      actions: [
        {
          action: "answer",
          title: "Answer",
          icon: "/vite.svg",
        },
        {
          action: "decline",
          title: "Decline",
          icon: "/vite.svg",
        },
      ],
    };

    return await this.sendNotificationToUser(receiverId, payload);
  }

  /**
   * Send system notification (blocking, friend request, etc.)
   */
  async sendSystemNotification(
    receiverId,
    title,
    message,
    type = "info",
    data = {}
  ) {
    const payload = {
      title: title,
      body: message,
      icon: "/vite.svg",
      tag: `system-${type}`,
      data: {
        type: "system",
        category: type,
        message: message,
        timestamp: Date.now(),
        ...data,
      },
      requireInteraction: false,
    };

    return await this.sendNotificationToUser(receiverId, payload);
  }

  /**
   * Send bulk notifications to multiple users
   */
  async sendBulkNotifications(userIds, notificationPayload) {
    const results = [];

    for (const userId of userIds) {
      const result = await this.sendNotificationToUser(
        userId,
        notificationPayload
      );
      results.push({ userId, ...result });
    }

    return results;
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats() {
    try {
      const users = await User.find({
        pushSubscriptions: { $exists: true, $ne: [] },
      }).select("name pushSubscriptions");

      const totalUsers = users.length;
      const totalSubscriptions = users.reduce(
        (sum, user) => sum + (user.pushSubscriptions?.length || 0),
        0
      );

      return {
        totalUsersWithSubscriptions: totalUsers,
        totalActiveSubscriptions: totalSubscriptions,
        averageSubscriptionsPerUser:
          totalUsers > 0 ? (totalSubscriptions / totalUsers).toFixed(2) : 0,
      };
    } catch (error) {
      console.error("Error getting notification stats:", error);
      return null;
    }
  }
}

// Create singleton instance
const notificationService = new NotificationService();

module.exports = notificationService;
