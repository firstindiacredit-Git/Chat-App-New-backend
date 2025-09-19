const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const ChatRoom = require("../models/ChatRoom");
const notificationService = require("../services/notificationService");

const router = express.Router();

// Middleware to authenticate user
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-otp -resetToken");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid token. User not found.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

// Block a user
router.post("/block", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = req.user._id;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Check if trying to block themselves
    if (userId === currentUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot block yourself",
      });
    }

    // Check if the user to block exists
    const userToBlock = await User.findById(userId);
    if (!userToBlock) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Add blocked user to current user's blocked list
    const currentUser = await User.findById(currentUserId);

    // Initialize blockedUsers array if it doesn't exist
    if (!currentUser.blockedUsers) {
      currentUser.blockedUsers = [];
    }

    // Check if user is already blocked
    if (currentUser.blockedUsers.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "User is already blocked",
      });
    }

    // Add to blocked list
    currentUser.blockedUsers.push(userId);
    await currentUser.save();

    // Also add current user to the blocked user's blockedBy list (optional, for mutual blocking)
    if (!userToBlock.blockedBy) {
      userToBlock.blockedBy = [];
    }
    if (!userToBlock.blockedBy.includes(currentUserId.toString())) {
      userToBlock.blockedBy.push(currentUserId);
      await userToBlock.save();
    }

    // Create system message for blocking action
    try {
      // Find or create chat room between users
      let chatRoom = await ChatRoom.findOne({
        participants: { $all: [currentUserId, userId] },
        roomType: "private",
      });

      if (!chatRoom) {
        chatRoom = new ChatRoom({
          participants: [currentUserId, userId],
          roomType: "private",
        });
        await chatRoom.save();
      }

      // Create system message
      const systemMessage = new Message({
        sender: currentUserId,
        receiver: userId,
        content: `${currentUser.name} blocked ${userToBlock.name}`,
        messageType: "system",
        chatRoom: chatRoom._id,
        isRead: false,
      });

      await systemMessage.save();

      // Populate sender info
      await systemMessage.populate("sender", "name email avatar");

      // Update chat room's last message
      chatRoom.lastMessage = systemMessage._id;
      chatRoom.lastActivity = new Date();
      await chatRoom.save();

      console.log(`📨 System message created: ${systemMessage.content}`);

      // Emit system message to both users via socket
      const io = req.app.get("io");
      if (io) {
        // Emit system message to both users
        io.to(`user_${currentUserId}`).emit("new-message", {
          message: systemMessage,
          chatRoomId: chatRoom._id,
        });
        io.to(`user_${userId}`).emit("new-message", {
          message: systemMessage,
          chatRoomId: chatRoom._id,
        });
      }
    } catch (error) {
      console.error("Error creating system message for blocking:", error);
    }

    // Emit blocking status update via socket to both users
    const io = req.app.get("io");
    if (io) {
      // Notify the blocked user that they've been blocked
      io.to(`user_${userId}`).emit("user-blocked", {
        blockedBy: {
          _id: currentUserId,
          name: currentUser.name,
        },
        message: "You have been blocked by this user",
      });

      // Notify the blocker that blocking was successful
      io.to(`user_${currentUserId}`).emit("user-block-status-updated", {
        blockedUser: {
          _id: userId,
          name: userToBlock.name,
        },
        action: "blocked",
        message: `${userToBlock.name} has been blocked`,
      });

      // Send push notification to blocked user
      try {
        await notificationService.sendSystemNotification(
          userId,
          "User Blocked",
          `You have been blocked by ${currentUser.name}`,
          "blocked",
          {
            blockedBy: currentUserId,
            blockedByName: currentUser.name,
          }
        );
        console.log(
          `📱 Push notification sent for blocking action to ${userToBlock.name}`
        );
      } catch (error) {
        console.error("📱 Failed to send blocking push notification:", error);
      }
    }

    res.json({
      success: true,
      message: `${userToBlock.name} has been blocked successfully`,
      data: {
        blockedUserId: userId,
        blockedUserName: userToBlock.name,
      },
    });
  } catch (error) {
    console.error("Block user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Unblock a user
router.post("/unblock", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = req.user._id;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get current user
    const currentUser = await User.findById(currentUserId);

    // Check if user is in blocked list
    if (
      !currentUser.blockedUsers ||
      !currentUser.blockedUsers.includes(userId)
    ) {
      return res.status(400).json({
        success: false,
        message: "User is not blocked",
      });
    }

    // Remove from blocked list
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (blockedUserId) => blockedUserId.toString() !== userId
    );
    await currentUser.save();

    // Remove from blockedBy list of the other user
    const userToUnblock = await User.findById(userId);
    if (userToUnblock && userToUnblock.blockedBy) {
      userToUnblock.blockedBy = userToUnblock.blockedBy.filter(
        (blockedById) => blockedById.toString() !== currentUserId.toString()
      );
      await userToUnblock.save();
    }

    // Create system message for unblocking action
    try {
      // Find or create chat room between users
      let chatRoom = await ChatRoom.findOne({
        participants: { $all: [currentUserId, userId] },
        roomType: "private",
      });

      if (!chatRoom) {
        chatRoom = new ChatRoom({
          participants: [currentUserId, userId],
          roomType: "private",
        });
        await chatRoom.save();
      }

      // Create system message
      const systemMessage = new Message({
        sender: currentUserId,
        receiver: userId,
        content: `${currentUser.name} unblocked ${
          userToUnblock ? userToUnblock.name : "User"
        }`,
        messageType: "system",
        chatRoom: chatRoom._id,
        isRead: false,
      });

      await systemMessage.save();

      // Populate sender info
      await systemMessage.populate("sender", "name email avatar");

      // Update chat room's last message
      chatRoom.lastMessage = systemMessage._id;
      chatRoom.lastActivity = new Date();
      await chatRoom.save();

      console.log(`📨 System message created: ${systemMessage.content}`);

      // Emit system message to both users via socket
      const io = req.app.get("io");
      if (io) {
        // Emit system message to both users
        io.to(`user_${currentUserId}`).emit("new-message", {
          message: systemMessage,
          chatRoomId: chatRoom._id,
        });
        io.to(`user_${userId}`).emit("new-message", {
          message: systemMessage,
          chatRoomId: chatRoom._id,
        });
      }
    } catch (error) {
      console.error("Error creating system message for unblocking:", error);
    }

    // Emit unblocking status update via socket to both users
    const io = req.app.get("io");
    if (io) {
      // Notify the unblocked user that they've been unblocked
      io.to(`user_${userId}`).emit("user-unblocked", {
        unblockedBy: {
          _id: currentUserId,
          name: currentUser.name,
        },
        message: "You have been unblocked by this user",
      });

      // Notify the unblocker that unblocking was successful
      io.to(`user_${currentUserId}`).emit("user-block-status-updated", {
        unblockedUser: {
          _id: userId,
          name: userToUnblock ? userToUnblock.name : "Unknown",
        },
        action: "unblocked",
        message: `${
          userToUnblock ? userToUnblock.name : "User"
        } has been unblocked`,
      });

      // Send push notification to unblocked user
      try {
        await notificationService.sendSystemNotification(
          userId,
          "User Unblocked",
          `You have been unblocked by ${currentUser.name}`,
          "unblocked",
          {
            unblockedBy: currentUserId,
            unblockedByName: currentUser.name,
          }
        );
        console.log(
          `📱 Push notification sent for unblocking action to ${
            userToUnblock?.name || "user"
          }`
        );
      } catch (error) {
        console.error("📱 Failed to send unblocking push notification:", error);
      }
    }

    res.json({
      success: true,
      message: "User has been unblocked successfully",
      data: {
        unblockedUserId: userId,
        unblockedUserName: userToUnblock ? userToUnblock.name : "Unknown",
      },
    });
  } catch (error) {
    console.error("Unblock user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get blocked users list
router.get("/blocked", authenticateUser, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate(
      "blockedUsers",
      "name email phone avatar _id"
    );

    const blockedUsers = currentUser.blockedUsers || [];

    res.json({
      success: true,
      message: "Blocked users retrieved successfully",
      data: {
        blockedUsers,
        totalBlocked: blockedUsers.length,
      },
    });
  } catch (error) {
    console.error("Get blocked users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get user profile by ID
router.get("/profile/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user profile (excluding sensitive data)
    const userProfile = await User.findById(userId).select(
      "name email phone avatar bio createdAt _id blockedUsers"
    );

    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if current user has blocked this user
    const currentUser = await User.findById(req.user._id).select(
      "blockedUsers"
    );
    const hasBlocked =
      currentUser.blockedUsers && currentUser.blockedUsers.includes(userId);

    // Check if current user is blocked by this user
    const isBlockedBy =
      userProfile.blockedUsers &&
      userProfile.blockedUsers.includes(req.user._id.toString());

    res.json({
      success: true,
      message: "User profile retrieved successfully",
      data: {
        user: userProfile,
        hasBlocked, // Current user has blocked this user
        isBlockedBy, // Current user is blocked by this user
        isBlocked: hasBlocked || isBlockedBy, // Either scenario means chat is blocked
      },
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
