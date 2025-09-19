const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const ChatRoom = require("../models/ChatRoom");

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

// Global search endpoint
router.get("/global", authenticateUser, async (req, res) => {
  try {
    const { q: query } = req.query;
    const currentUserId = req.user._id;

    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const searchTerm = query.trim();
    const searchRegex = new RegExp(searchTerm, "i");

    // Search for users (contacts)
    const users = await User.find({
      _id: { $ne: currentUserId }, // Exclude current user
      isEmailVerified: true,
      $or: [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ],
    })
      .select("name email phone avatar")
      .limit(20);

    // Search for chat rooms (by participant name)
    const chatRooms = await ChatRoom.find({
      participants: currentUserId,
      isActive: true,
      deletedFor: { $ne: currentUserId }, // Exclude deleted chats
    })
      .populate("participants", "name email avatar")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "name avatar",
        },
      });

    // Filter chat rooms by name match
    const matchingChats = chatRooms
      .filter((room) => {
        const otherParticipant = room.participants.find(
          (p) => p._id.toString() !== currentUserId.toString()
        );
        return otherParticipant && searchRegex.test(otherParticipant.name);
      })
      .map((room) => {
        const otherParticipant = room.participants.find(
          (p) => p._id.toString() !== currentUserId.toString()
        );
        return {
          _id: room._id,
          id: otherParticipant._id,
          name: otherParticipant.name,
          avatar: otherParticipant.avatar,
          lastMessage: room.lastMessage ? room.lastMessage.content : "",
          lastActivity: room.lastActivity,
        };
      });

    // Search for messages
    const messages = await Message.find({
      $or: [{ sender: currentUserId }, { receiver: currentUserId }],
      content: searchRegex,
      isDeleted: { $ne: true },
    })
      .populate("sender", "name email avatar")
      .populate("receiver", "name email avatar")
      .sort({ timestamp: -1 })
      .limit(50);

    console.log(`🔍 Global search for "${searchTerm}":`, {
      users: users.length,
      chats: matchingChats.length,
      messages: messages.length,
      currentUser: req.user.name,
    });

    res.json({
      success: true,
      message: "Search completed successfully",
      data: {
        users: users,
        chats: matchingChats,
        messages: messages,
        query: searchTerm,
        totalResults: users.length + matchingChats.length + messages.length,
      },
    });
  } catch (error) {
    console.error("Global search error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Search messages in a specific chat
router.get("/chat/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId: otherUserId } = req.params;
    const { q: query } = req.query;
    const currentUserId = req.user._id;

    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const searchTerm = query.trim();
    const searchRegex = new RegExp(searchTerm, "i");

    // Find messages in this specific chat
    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUserId },
      ],
      content: searchRegex,
      isDeleted: { $ne: true },
    })
      .populate("sender", "name email avatar")
      .populate("receiver", "name email avatar")
      .sort({ timestamp: -1 })
      .limit(100);

    res.json({
      success: true,
      message: "Chat search completed successfully",
      data: {
        messages: messages,
        query: searchTerm,
        totalResults: messages.length,
        chatWith: otherUserId,
      },
    });
  } catch (error) {
    console.error("Chat search error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
