const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");

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

// Send friend request
router.post("/request", authenticateUser, async (req, res) => {
  try {
    const { userId, message = "" } = req.body;
    const senderId = req.user._id;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Check if trying to send request to themselves
    if (userId === senderId.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot send friend request to yourself",
      });
    }

    // Check if the user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if users are already friends
    const currentUser = await User.findById(senderId);
    if (currentUser.friends && currentUser.friends.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "You are already friends with this user",
      });
    }

    // Check if friend request already exists
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { sender: senderId, receiver: userId },
        { sender: userId, receiver: senderId },
      ],
    });

    if (existingRequest) {
      if (existingRequest.status === "pending") {
        return res.status(400).json({
          success: false,
          message: "Friend request already exists",
        });
      } else if (existingRequest.status === "accepted") {
        return res.status(400).json({
          success: false,
          message: "You are already friends",
        });
      }
    }

    // Create new friend request
    const friendRequest = new FriendRequest({
      sender: senderId,
      receiver: userId,
      message: message.trim(),
      status: "pending",
    });

    await friendRequest.save();

    // Populate sender info for response
    await friendRequest.populate("sender", "name email avatar");
    await friendRequest.populate("receiver", "name email avatar");

    res.json({
      success: true,
      message: `Friend request sent to ${targetUser.name}`,
      data: {
        friendRequest,
      },
    });
  } catch (error) {
    console.error("Send friend request error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Accept friend request
router.post("/accept/:requestId", authenticateUser, async (req, res) => {
  try {
    const { requestId } = req.params;
    const currentUserId = req.user._id;

    // Find the friend request
    const friendRequest = await FriendRequest.findById(requestId)
      .populate("sender", "name email avatar")
      .populate("receiver", "name email avatar");

    if (!friendRequest) {
      return res.status(404).json({
        success: false,
        message: "Friend request not found",
      });
    }

    // Check if current user is the receiver
    if (friendRequest.receiver._id.toString() !== currentUserId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only accept requests sent to you",
      });
    }

    // Check if request is still pending
    if (friendRequest.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Friend request is no longer pending",
      });
    }

    // Update friend request status
    friendRequest.status = "accepted";
    await friendRequest.save();

    // Add users to each other's friends list
    await User.findByIdAndUpdate(friendRequest.sender._id, {
      $addToSet: { friends: friendRequest.receiver._id },
    });

    await User.findByIdAndUpdate(friendRequest.receiver._id, {
      $addToSet: { friends: friendRequest.sender._id },
    });

    res.json({
      success: true,
      message: `You are now friends with ${friendRequest.sender.name}`,
      data: {
        friendRequest,
        newFriend: friendRequest.sender,
      },
    });
  } catch (error) {
    console.error("Accept friend request error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Reject friend request
router.post("/reject/:requestId", authenticateUser, async (req, res) => {
  try {
    const { requestId } = req.params;
    const currentUserId = req.user._id;

    // Find the friend request
    const friendRequest = await FriendRequest.findById(requestId).populate(
      "sender",
      "name email avatar"
    );

    if (!friendRequest) {
      return res.status(404).json({
        success: false,
        message: "Friend request not found",
      });
    }

    // Check if current user is the receiver
    if (friendRequest.receiver.toString() !== currentUserId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only reject requests sent to you",
      });
    }

    // Update friend request status
    friendRequest.status = "rejected";
    await friendRequest.save();

    res.json({
      success: true,
      message: `Friend request from ${friendRequest.sender.name} rejected`,
      data: {
        friendRequest,
      },
    });
  } catch (error) {
    console.error("Reject friend request error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get received friend requests
router.get("/requests/received", authenticateUser, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      receiver: req.user._id,
      status: "pending",
    })
      .populate("sender", "name email avatar phone")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: "Friend requests retrieved successfully",
      data: {
        requests,
        totalRequests: requests.length,
      },
    });
  } catch (error) {
    console.error("Get friend requests error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get sent friend requests
router.get("/requests/sent", authenticateUser, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      sender: req.user._id,
    })
      .populate("receiver", "name email avatar phone")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: "Sent friend requests retrieved successfully",
      data: {
        requests,
        totalRequests: requests.length,
      },
    });
  } catch (error) {
    console.error("Get sent requests error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get friends list
router.get("/list", authenticateUser, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate(
      "friends",
      "name email phone avatar"
    );

    const friends = currentUser.friends || [];

    res.json({
      success: true,
      message: "Friends list retrieved successfully",
      data: {
        friends,
        totalFriends: friends.length,
      },
    });
  } catch (error) {
    console.error("Get friends list error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Remove friend
router.delete("/remove/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Check if the user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Remove from both users' friends lists
    await User.findByIdAndUpdate(currentUserId, {
      $pull: { friends: userId },
    });

    await User.findByIdAndUpdate(userId, {
      $pull: { friends: currentUserId },
    });

    // Update any existing friend request to rejected status
    await FriendRequest.findOneAndUpdate(
      {
        $or: [
          { sender: currentUserId, receiver: userId },
          { sender: userId, receiver: currentUserId },
        ],
      },
      { status: "rejected" }
    );

    res.json({
      success: true,
      message: `${targetUser.name} removed from friends`,
      data: {
        removedFriend: {
          id: userId,
          name: targetUser.name,
        },
      },
    });
  } catch (error) {
    console.error("Remove friend error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Check friendship status with a user
router.get("/status/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    // Check if users are friends
    const currentUser = await User.findById(currentUserId);
    const isFriend =
      currentUser.friends && currentUser.friends.includes(userId);

    // Check for pending friend requests
    const sentRequest = await FriendRequest.findOne({
      sender: currentUserId,
      receiver: userId,
      status: "pending",
    });

    const receivedRequest = await FriendRequest.findOne({
      sender: userId,
      receiver: currentUserId,
      status: "pending",
    });

    let status = "none"; // none, friend, sent, received
    let requestId = null;

    if (isFriend) {
      status = "friend";
    } else if (sentRequest) {
      status = "sent";
      requestId = sentRequest._id;
    } else if (receivedRequest) {
      status = "received";
      requestId = receivedRequest._id;
    }

    res.json({
      success: true,
      message: "Friendship status retrieved successfully",
      data: {
        status,
        requestId,
        isFriend,
        hasPendingRequest: !!(sentRequest || receivedRequest),
      },
    });
  } catch (error) {
    console.error("Check friendship status error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
