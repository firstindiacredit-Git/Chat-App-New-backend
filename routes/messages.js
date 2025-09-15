const express = require("express");
const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const ChatRoom = require("../models/ChatRoom");
const User = require("../models/User");

const router = express.Router();

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

// Get chat history with a specific user
router.get("/chat/:userId", verifyToken, async (req, res) => {
  try {
    const { userId: otherUserId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Validate other user exists
    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find chat room
    const chatRoom = await ChatRoom.findOne({
      participants: { $all: [req.userId, otherUserId] },
      roomType: "private",
    });

    let messages = [];

    if (chatRoom) {
      // Get messages from chat room
      messages = await Message.find({
        $or: [
          { sender: req.userId, receiver: otherUserId },
          { sender: otherUserId, receiver: req.userId },
        ],
      })
        .populate("sender", "name email avatar")
        .populate("receiver", "name email avatar")
        .sort({ timestamp: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
    }

    // Mark messages as read
    await Message.updateMany(
      {
        sender: otherUserId,
        receiver: req.userId,
        isRead: false,
      },
      { isRead: true }
    );

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse to show oldest first
        otherUser: {
          id: otherUser._id,
          name: otherUser.name,
          email: otherUser.email,
          avatar: otherUser.avatar,
        },
        chatRoomId: chatRoom?._id || null,
      },
    });
  } catch (error) {
    console.error("Get chat history error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get all chat rooms for current user
router.get("/chatrooms", verifyToken, async (req, res) => {
  try {
    const chatRooms = await ChatRoom.find({
      participants: req.userId,
      isActive: true,
    })
      .populate("participants", "name email avatar")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "name avatar",
        },
      })
      .sort({ lastActivity: -1 });

    // Format chat rooms data and calculate unread counts
    const formattedChatRooms = await Promise.all(
      chatRooms.map(async (room) => {
        const otherParticipant = room.participants.find(
          (p) => p._id.toString() !== req.userId
        );

        // Calculate unread count for this chat room
        const unreadCount = await Message.countDocuments({
          sender: otherParticipant._id,
          receiver: req.userId,
          isRead: false,
        });

        return {
          id: room._id,
          otherUser: {
            id: otherParticipant._id,
            name: otherParticipant.name,
            email: otherParticipant.email,
            avatar: otherParticipant.avatar,
          },
          lastMessage: room.lastMessage
            ? {
                id: room.lastMessage._id,
                content: room.lastMessage.content,
                timestamp: room.lastMessage.timestamp,
                sender: room.lastMessage.sender,
                isRead: room.lastMessage.isRead,
              }
            : null,
          lastActivity: room.lastActivity,
          unreadCount: unreadCount,
        };
      })
    );

    res.json({
      success: true,
      data: {
        chatRooms: formattedChatRooms,
      },
    });
  } catch (error) {
    console.error("Get chat rooms error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Mark messages as read for a specific user
router.put("/mark-read/:userId", verifyToken, async (req, res) => {
  try {
    const { userId: senderId } = req.params;

    // Mark all unread messages from this sender as read
    const result = await Message.updateMany(
      {
        sender: senderId,
        receiver: req.userId,
        isRead: false,
      },
      { isRead: true }
    );

    console.log(
      `✅ Marked ${result.modifiedCount} messages as read from user ${senderId}`
    );

    res.json({
      success: true,
      data: {
        messagesMarkedAsRead: result.modifiedCount,
        senderId: senderId,
      },
    });
  } catch (error) {
    console.error("Mark messages as read error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get unread message count
router.get("/unread-count", verifyToken, async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({
      receiver: req.userId,
      isRead: false,
    });

    res.json({
      success: true,
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Send message with file attachment
router.post("/send", verifyToken, async (req, res) => {
  try {
    const {
      receiverId,
      groupId,
      content,
      messageType = "text",
      attachment,
    } = req.body;

    // Validate required fields
    if (!receiverId && !groupId) {
      return res.status(400).json({
        success: false,
        message: "Either receiverId or groupId is required",
      });
    }

    if (!content && !attachment) {
      return res.status(400).json({
        success: false,
        message: "Either content or attachment is required",
      });
    }

    // Validate message type
    const validMessageTypes = ["text", "image", "video", "file"];
    if (!validMessageTypes.includes(messageType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message type",
      });
    }

    // Create message object
    const messageData = {
      sender: req.userId,
      content: content || "",
      messageType: messageType,
      timestamp: new Date(),
    };

    // Add receiver or group
    if (receiverId) {
      messageData.receiver = receiverId;
    } else {
      messageData.group = groupId;
    }

    // Add attachment if provided
    if (attachment) {
      messageData.attachment = attachment;
    }

    // Create and save message
    const message = new Message(messageData);
    await message.save();

    // Populate sender information
    await message.populate("sender", "name email avatar");
    if (message.receiver) {
      await message.populate("receiver", "name email avatar");
    }
    if (message.group) {
      await message.populate("group", "name");
    }

    res.json({
      success: true,
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Delete message (soft delete)
router.delete("/message/:messageId", verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findOne({
      _id: messageId,
      sender: req.userId,
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found or unauthorized",
      });
    }

    // For now, we'll just mark as deleted (soft delete)
    // In a real app, you might want to actually delete or mark differently
    message.content = "This message was deleted";
    message.messageType = "deleted";
    await message.save();

    res.json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
