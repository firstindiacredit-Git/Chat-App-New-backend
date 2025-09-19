const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const Story = require("../models/Story");
const User = require("../models/User");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/stories/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"), false);
    }
  },
});

// Socket.IO instance (will be set by server.js)
let io = null;
const setSocketIO = (socketIO) => {
  io = socketIO;
};

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

// Create a new story
router.post(
  "/create",
  verifyToken,
  upload.single("media"),
  async (req, res) => {
    try {
      const {
        content,
        mediaType = "text",
        backgroundColor = "#25D366",
        textColor = "#ffffff",
        textSize = "medium",
      } = req.body;

      // Handle media upload
      let mediaUrl = "";
      let finalMediaType = mediaType;

      if (req.file) {
        // File was uploaded
        mediaUrl = `/uploads/stories/${req.file.filename}`;
        finalMediaType = req.file.mimetype.startsWith("image/")
          ? "image"
          : "video";
      }

      if (!content && !req.file) {
        return res.status(400).json({
          success: false,
          message: "Story must have either content or media",
        });
      }

      const story = new Story({
        author: req.userId,
        content: content || "",
        media: mediaUrl,
        mediaType: finalMediaType,
        backgroundColor: backgroundColor,
        textColor: textColor,
        textSize: textSize,
      });

      await story.save();
      await story.populate("author", "name avatar");

      // Emit socket event for new story
      if (io) {
        io.emit("new-story", {
          story: {
            id: story._id,
            content: story.content,
            media: story.media,
            mediaType: story.mediaType,
            backgroundColor: story.backgroundColor,
            textColor: story.textColor,
            textSize: story.textSize,
            author: {
              id: story.author._id,
              name: story.author.name,
              avatar: story.author.avatar,
            },
            viewCount: story.viewCount,
            hasUserViewed: false,
            createdAt: story.createdAt,
            expiresAt: story.expiresAt,
          },
          author: story.author,
        });
      }

      res.status(201).json({
        success: true,
        message: "Story created successfully",
        data: {
          story: {
            id: story._id,
            content: story.content,
            media: story.media,
            mediaType: story.mediaType,
            backgroundColor: story.backgroundColor,
            textColor: story.textColor,
            textSize: story.textSize,
            author: {
              id: story.author._id,
              name: story.author.name,
              avatar: story.author.avatar,
            },
            viewCount: story.viewCount,
            hasUserViewed: false,
            createdAt: story.createdAt,
            expiresAt: story.expiresAt,
          },
        },
      });
    } catch (error) {
      console.error("Create story error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Get all active stories for the current user and their friends only
router.get("/feed", verifyToken, async (req, res) => {
  try {
    // First, get the current user with their friends list
    const currentUser = await User.findById(req.userId).populate(
      "friends",
      "_id"
    );

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get array of friend IDs
    const friendIds = currentUser.friends
      ? currentUser.friends.map((friend) => friend._id)
      : [];

    // Get active stories only from friends (excluding current user's own stories)
    const stories = await Story.find({
      isActive: true,
      expiresAt: { $gt: new Date() },
      author: { $in: friendIds }, // Only stories from friends
    })
      .populate("author", "name avatar")
      .sort({ createdAt: -1 });

    // Group stories by author
    const storiesByAuthor = {};

    stories.forEach((story) => {
      const authorId = story.author._id.toString();

      if (!storiesByAuthor[authorId]) {
        storiesByAuthor[authorId] = {
          author: {
            id: story.author._id,
            name: story.author.name,
            avatar: story.author.avatar,
          },
          stories: [],
          hasUnviewedStories: false,
        };
      }

      // Check if current user has viewed this story
      const hasViewed = story.hasUserViewed(req.userId);

      storiesByAuthor[authorId].stories.push({
        id: story._id,
        content: story.content,
        media: story.media,
        mediaType: story.mediaType,
        backgroundColor: story.backgroundColor,
        textColor: story.textColor,
        textSize: story.textSize,
        viewCount: story.viewCount,
        hasUserViewed: hasViewed,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
      });

      // Mark if there are unviewed stories from this author
      if (!hasViewed) {
        storiesByAuthor[authorId].hasUnviewedStories = true;
      }
    });

    // Convert to array and sort by most recent story
    const feedData = Object.values(storiesByAuthor).sort((a, b) => {
      const aLatestStory = a.stories[0];
      const bLatestStory = b.stories[0];
      return (
        new Date(bLatestStory.createdAt) - new Date(aLatestStory.createdAt)
      );
    });

    res.json({
      success: true,
      data: {
        stories: feedData,
      },
    });
  } catch (error) {
    console.error("Get stories feed error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get stories for a specific user (only if they are friends or own stories)
router.get("/user/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // If user is requesting their own stories, allow it
    if (userId === req.userId) {
      const stories = await Story.find({
        author: userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      })
        .populate("author", "name avatar")
        .sort({ createdAt: -1 });

      const formattedStories = stories.map((story) => ({
        id: story._id,
        content: story.content,
        media: story.media,
        mediaType: story.mediaType,
        backgroundColor: story.backgroundColor,
        textColor: story.textColor,
        textSize: story.textSize,
        viewCount: story.viewCount,
        hasUserViewed: story.hasUserViewed(req.userId),
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
      }));

      return res.json({
        success: true,
        data: {
          stories: formattedStories,
          author:
            stories.length > 0
              ? {
                  id: stories[0].author._id,
                  name: stories[0].author.name,
                  avatar: stories[0].author.avatar,
                }
              : null,
        },
      });
    }

    // For other users, check if they are friends first
    const currentUser = await User.findById(req.userId).populate(
      "friends",
      "_id"
    );

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if the requested user is in current user's friends list
    const friendIds = currentUser.friends
      ? currentUser.friends.map((friend) => friend._id.toString())
      : [];
    const isFriend = friendIds.includes(userId);

    if (!isFriend) {
      return res.status(403).json({
        success: false,
        message: "You can only view stories from friends",
      });
    }

    // User is a friend, proceed to get their stories
    const stories = await Story.find({
      author: userId,
      isActive: true,
      expiresAt: { $gt: new Date() },
    })
      .populate("author", "name avatar")
      .sort({ createdAt: -1 });

    const formattedStories = stories.map((story) => ({
      id: story._id,
      content: story.content,
      media: story.media,
      mediaType: story.mediaType,
      backgroundColor: story.backgroundColor,
      textColor: story.textColor,
      textSize: story.textSize,
      viewCount: story.viewCount,
      hasUserViewed: story.hasUserViewed(req.userId),
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
    }));

    res.json({
      success: true,
      data: {
        stories: formattedStories,
        author:
          stories.length > 0
            ? {
                id: stories[0].author._id,
                name: stories[0].author.name,
                avatar: stories[0].author.avatar,
              }
            : null,
      },
    });
  } catch (error) {
    console.error("Get user stories error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Mark a story as viewed
router.post("/view/:storyId", verifyToken, async (req, res) => {
  try {
    const { storyId } = req.params;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: "Story not found",
      });
    }

    if (story.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Story has expired",
      });
    }

    await story.addView(req.userId);

    // Emit socket event for story view
    if (io) {
      io.emit("story-viewed", {
        storyId: story._id,
        authorId: story.author,
        viewer: req.userId,
        viewCount: story.viewCount + 1,
      });
    }

    res.json({
      success: true,
      message: "Story marked as viewed",
      data: {
        viewCount: story.viewCount + 1,
      },
    });
  } catch (error) {
    console.error("View story error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Delete a story (only by author)
router.delete("/:storyId", verifyToken, async (req, res) => {
  try {
    const { storyId } = req.params;

    const story = await Story.findOne({
      _id: storyId,
      author: req.userId,
    });

    if (!story) {
      return res.status(404).json({
        success: false,
        message: "Story not found or unauthorized",
      });
    }

    story.isActive = false;
    await story.save();

    // Emit socket event for story deletion
    if (io) {
      io.emit("story-deleted", {
        storyId: story._id,
        author: req.userId,
      });
    }

    res.json({
      success: true,
      message: "Story deleted successfully",
    });
  } catch (error) {
    console.error("Delete story error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get story viewers
router.get("/:storyId/viewers", verifyToken, async (req, res) => {
  try {
    const { storyId } = req.params;

    const story = await Story.findById(storyId).populate(
      "views.user",
      "name avatar"
    );

    if (!story) {
      return res.status(404).json({
        success: false,
        message: "Story not found",
      });
    }

    // Check if user is the author of the story
    if (story.author.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: "You can only view viewers of your own stories",
      });
    }

    res.json({
      success: true,
      data: {
        viewers: story.views.map((view) => ({
          user: {
            _id: view.user._id,
            name: view.user.name,
            avatar: view.user.avatar,
          },
          viewedAt: view.viewedAt,
        })),
      },
    });
  } catch (error) {
    console.error("Get story viewers error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get story statistics for current user
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const totalStories = await Story.countDocuments({
      author: req.userId,
      isActive: true,
    });

    const activeStories = await Story.countDocuments({
      author: req.userId,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    const totalViews = await Story.aggregate([
      { $match: { author: req.userId, isActive: true } },
      { $project: { viewCount: { $size: "$views" } } },
      { $group: { _id: null, totalViews: { $sum: "$viewCount" } } },
    ]);

    res.json({
      success: true,
      data: {
        totalStories,
        activeStories,
        totalViews: totalViews[0]?.totalViews || 0,
      },
    });
  } catch (error) {
    console.error("Get story stats error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = { router, setSocketIO };
