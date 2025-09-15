const express = require("express");
const jwt = require("jsonwebtoken");
const Group = require("../models/Group");
const Message = require("../models/Message");
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

// Create a new group
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { name, description, avatar, memberIds } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }

    // Validate member IDs
    const validMembers = [];
    if (memberIds && memberIds.length > 0) {
      for (const memberId of memberIds) {
        const user = await User.findById(memberId);
        if (user) {
          validMembers.push(memberId);
        }
      }
    }

    // Create group
    const group = new Group({
      name: name.trim(),
      description: description?.trim() || "",
      avatar: avatar || "",
      createdBy: req.userId,
      members: [req.userId, ...validMembers], // Creator is automatically added
    });

    await group.save();

    // Populate the group with user details
    await group.populate([
      { path: "createdBy", select: "name email avatar" },
      { path: "admins", select: "name email avatar" },
      { path: "members", select: "name email avatar" },
    ]);

    res.status(201).json({
      success: true,
      message: "Group created successfully",
      data: { group },
    });
  } catch (error) {
    console.error("Create group error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get all groups for current user
router.get("/", verifyToken, async (req, res) => {
  try {
    const groups = await Group.find({
      members: req.userId,
      isActive: true,
    })
      .populate("createdBy", "name email avatar")
      .populate("admins", "name email avatar")
      .populate("members", "name email avatar")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "name avatar",
        },
      })
      .sort({ lastActivity: -1 });

    // Calculate unread counts for each group
    const groupsWithUnreadCounts = await Promise.all(
      groups.map(async (group) => {
        const unreadCount = await Message.countDocuments({
          group: group._id,
          sender: { $ne: req.userId },
          readBy: { $not: { $elemMatch: { user: req.userId } } },
        });

        return {
          ...group.toObject(),
          unreadCount,
        };
      })
    );

    res.json({
      success: true,
      data: { groups: groupsWithUnreadCounts },
    });
  } catch (error) {
    console.error("Get groups error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get group details
router.get("/:groupId", verifyToken, async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      members: req.userId,
      isActive: true,
    })
      .populate("createdBy", "name email avatar")
      .populate("admins", "name email avatar")
      .populate("members", "name email avatar");

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found or you are not a member",
      });
    }

    res.json({
      success: true,
      data: { group },
    });
  } catch (error) {
    console.error("Get group details error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get group messages
router.get("/:groupId/messages", verifyToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check if user is member of the group
    const group = await Group.findOne({
      _id: groupId,
      members: req.userId,
      isActive: true,
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found or you are not a member",
      });
    }

    // Get messages
    const messages = await Message.find({ group: groupId })
      .populate("sender", "name email avatar")
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Mark messages as read for current user
    const messageIds = messages.map((msg) => msg._id);
    await Message.updateMany(
      {
        _id: { $in: messageIds },
        sender: { $ne: req.userId },
        "readBy.user": { $ne: req.userId },
      },
      {
        $push: {
          readBy: {
            user: req.userId,
            readAt: new Date(),
          },
        },
      }
    );

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse to show oldest first
        group: {
          id: group._id,
          name: group.name,
          avatar: group.avatar,
          members: group.members,
        },
      },
    });
  } catch (error) {
    console.error("Get group messages error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Add members to group
router.post("/:groupId/members", verifyToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberIds } = req.body;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Member IDs are required",
      });
    }

    const group = await Group.findOne({
      _id: groupId,
      $or: [{ createdBy: req.userId }, { admins: req.userId }],
      isActive: true,
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found or you don't have permission to add members",
      });
    }

    // Validate and add new members
    const newMembers = [];
    for (const memberId of memberIds) {
      if (!group.members.includes(memberId)) {
        const user = await User.findById(memberId);
        if (user) {
          newMembers.push(memberId);
        }
      }
    }

    if (newMembers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid new members to add",
      });
    }

    // Add members to group
    group.members.push(...newMembers);
    await group.save();

    // Create system message for new members
    const addedUsers = await User.find({ _id: { $in: newMembers } });
    const systemMessage = new Message({
      sender: req.userId,
      group: groupId,
      content: `Added ${addedUsers.map((u) => u.name).join(", ")} to the group`,
      messageType: "system",
    });
    await systemMessage.save();

    // Update group's last message and activity
    group.lastMessage = systemMessage._id;
    group.lastActivity = new Date();
    await group.save();

    await group.populate([
      { path: "createdBy", select: "name email avatar" },
      { path: "admins", select: "name email avatar" },
      { path: "members", select: "name email avatar" },
    ]);

    res.json({
      success: true,
      message: "Members added successfully",
      data: { group },
    });
  } catch (error) {
    console.error("Add members error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Remove member from group
router.delete("/:groupId/members/:memberId", verifyToken, async (req, res) => {
  try {
    const { groupId, memberId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      $or: [{ createdBy: req.userId }, { admins: req.userId }],
      isActive: true,
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message:
          "Group not found or you don't have permission to remove members",
      });
    }

    // Check if member exists in group
    if (!group.members.includes(memberId)) {
      return res.status(400).json({
        success: false,
        message: "Member not found in group",
      });
    }

    // Remove member from group
    group.members = group.members.filter((id) => id.toString() !== memberId);
    group.admins = group.admins.filter((id) => id.toString() !== memberId);
    await group.save();

    // Create system message
    const removedUser = await User.findById(memberId);
    const systemMessage = new Message({
      sender: req.userId,
      group: groupId,
      content: `Removed ${removedUser?.name || "Unknown"} from the group`,
      messageType: "system",
    });
    await systemMessage.save();

    // Update group's last message and activity
    group.lastMessage = systemMessage._id;
    group.lastActivity = new Date();
    await group.save();

    res.json({
      success: true,
      message: "Member removed successfully",
    });
  } catch (error) {
    console.error("Remove member error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Leave group
router.post("/:groupId/leave", verifyToken, async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      members: req.userId,
      isActive: true,
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found or you are not a member",
      });
    }

    // Check if user is the creator
    if (group.createdBy.toString() === req.userId) {
      return res.status(400).json({
        success: false,
        message:
          "Group creator cannot leave the group. Transfer ownership or delete the group instead.",
      });
    }

    // Remove user from group
    group.members = group.members.filter((id) => id.toString() !== req.userId);
    group.admins = group.admins.filter((id) => id.toString() !== req.userId);
    await group.save();

    // Create system message
    const currentUser = await User.findById(req.userId);
    const systemMessage = new Message({
      sender: req.userId,
      group: groupId,
      content: `${currentUser?.name || "Unknown"} left the group`,
      messageType: "system",
    });
    await systemMessage.save();

    // Update group's last message and activity
    group.lastMessage = systemMessage._id;
    group.lastActivity = new Date();
    await group.save();

    res.json({
      success: true,
      message: "Left group successfully",
    });
  } catch (error) {
    console.error("Leave group error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Update group settings
router.put("/:groupId/settings", verifyToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, avatar, settings } = req.body;

    const group = await Group.findOne({
      _id: groupId,
      $or: [{ createdBy: req.userId }, { admins: req.userId }],
      isActive: true,
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message:
          "Group not found or you don't have permission to update settings",
      });
    }

    // Update group fields
    if (name !== undefined) group.name = name.trim();
    if (description !== undefined) group.description = description.trim();
    if (avatar !== undefined) group.avatar = avatar;
    if (settings) {
      group.settings = { ...group.settings, ...settings };
    }

    await group.save();

    await group.populate([
      { path: "createdBy", select: "name email avatar" },
      { path: "admins", select: "name email avatar" },
      { path: "members", select: "name email avatar" },
    ]);

    res.json({
      success: true,
      message: "Group settings updated successfully",
      data: { group },
    });
  } catch (error) {
    console.error("Update group settings error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Delete group
router.delete("/:groupId", verifyToken, async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      createdBy: req.userId,
      isActive: true,
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found or you don't have permission to delete it",
      });
    }

    // Soft delete the group
    group.isActive = false;
    await group.save();

    res.json({
      success: true,
      message: "Group deleted successfully",
    });
  } catch (error) {
    console.error("Delete group error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
