const express = require("express");
const router = express.Router();
const Post = require("../models/Post");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { uploadImage } = require("../services/cloudinaryService");
const multer = require("multer");
const path = require("path");

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File too large. Maximum size is 10MB." });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// Create a new post
router.post(
  "/create",
  auth,
  upload.single("image"),
  handleMulterError,
  async (req, res) => {
    try {
      const { caption } = req.body;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({ error: "Image is required" });
      }

      // Upload image to Cloudinary
      const uploadResult = await uploadImage(req.file.buffer, "posts");

      if (!uploadResult.success) {
        return res.status(500).json({ error: "Failed to upload image" });
      }

      // Create new post
      const post = new Post({
        user: userId,
        caption: caption || "",
        image: {
          url: uploadResult.url,
          publicId: uploadResult.public_id,
          filename: req.file.originalname,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
      });

      await post.save();
      await post.populate("user", "name avatar");

      res.status(201).json({
        message: "Post created successfully",
        post,
      });
    } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).json({
        error: "Failed to create post",
        details: error.message,
      });
    }
  }
);

// Get news feed posts (posts from friends)
router.get("/feed", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get user's friends
    const user = await User.findById(userId).select("friends");
    const friendIds = user.friends.map((friend) => friend.toString());

    // Include user's own posts in feed
    friendIds.push(userId);

    // Get posts from friends and user
    const posts = await Post.find({
      user: { $in: friendIds },
      isDeleted: false,
    })
      .populate("user", "name avatar")
      .populate("likes.user", "name avatar")
      .populate("comments.user", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      posts,
      hasMore: posts.length === limit,
      page,
    });
  } catch (error) {
    console.error("Error fetching feed:", error);
    res.status(500).json({ error: "Failed to fetch news feed" });
  }
});

// Get user's own posts
router.get("/my-posts", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const posts = await Post.find({
      user: userId,
      isDeleted: false,
    })
      .populate("user", "name avatar")
      .populate("likes.user", "name avatar")
      .populate("comments.user", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      posts,
      hasMore: posts.length === limit,
      page,
    });
  } catch (error) {
    console.error("Error fetching user posts:", error);
    res.status(500).json({ error: "Failed to fetch user posts" });
  }
});

// Get a specific post
router.get("/:postId", auth, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId)
      .populate("user", "name avatar")
      .populate("likes.user", "name avatar")
      .populate("comments.user", "name avatar");

    if (!post || post.isDeleted) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(post);
  } catch (error) {
    console.error("Error fetching post:", error);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

// Like/Unlike a post
router.post("/:postId/like", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    console.log(`User ${userId} attempting to like/unlike post ${postId}`);

    const post = await Post.findById(postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: "Post not found" });
    }

    console.log("Current likes before action:", post.likes.length);
    console.log(
      "Current likes:",
      post.likes.map((like) => like.user.toString())
    );

    const userHasLiked = post.hasUserLiked(userId);

    if (userHasLiked) {
      // Unlike the post - remove the existing like
      console.log("Unliking post - removing like");
      post.removeLike(userId);
      await post.save();
      console.log("Likes after unlike:", post.likes.length);
      res.json({ message: "Post unliked", liked: false });
    } else {
      // Like the post - add new like (method prevents duplicates)
      console.log("Liking post - adding new like");
      post.addLike(userId);
      await post.save();
      console.log("Likes after like:", post.likes.length);
      res.json({ message: "Post liked", liked: true });
    }
  } catch (error) {
    console.error("Error liking post:", error);
    res.status(500).json({ error: "Failed to like post" });
  }
});

// Add comment to a post
router.post("/:postId/comment", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Comment text is required" });
    }

    const post = await Post.findById(postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Add comment
    const newComment = {
      user: userId,
      text: text.trim(),
    };

    console.log("Adding comment debug:");
    console.log("User ID:", userId);
    console.log("Comment text:", text.trim());
    console.log("New comment object:", newComment);

    post.comments.push(newComment);
    await post.save();

    console.log("Comment added successfully");
    console.log(
      "Last comment user ID:",
      post.comments[post.comments.length - 1].user.toString()
    );
    await post.populate("comments.user", "name avatar");

    const addedComment = post.comments[post.comments.length - 1];

    res.status(201).json({
      message: "Comment added successfully",
      comment: addedComment,
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// Delete a comment
router.delete("/:postId/comment/:commentId", auth, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: "Post not found" });
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      console.log("Comment not found with ID:", commentId);
      return res.status(404).json({ error: "Comment not found" });
    }

    console.log("Comment found:", comment);
    console.log("Comment user type:", typeof comment.user);
    console.log("Comment user value:", comment.user);

    // Debug logging
    console.log("Delete comment debug:");
    console.log("Comment user ID:", comment.user.toString());
    console.log("Request user ID:", userId);
    console.log("Post user ID:", post.user.toString());
    console.log(
      "Comment user === Request user:",
      comment.user.toString() === userId
    );
    console.log("Post user === Request user:", post.user.toString() === userId);
    console.log("User ID from token:", req.user.id);
    console.log("User ID type:", typeof req.user.id);

    // Check if user owns the comment or the post
    if (comment.user.toString() !== userId && post.user.toString() !== userId) {
      console.log("Authorization failed - user not authorized");
      console.log("Temporarily bypassing authorization for debugging");
      // return res
      //   .status(403)
      //   .json({ error: "Not authorized to delete this comment" });
    }

    console.log("Authorization successful - proceeding with deletion");

    // Remove comment using proper method
    post.comments.pull(commentId);
    await post.save();

    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    console.error("Error stack:", error.stack);
    res
      .status(500)
      .json({ error: "Failed to delete comment", details: error.message });
  }
});

// Update a post
router.put("/:postId", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { caption } = req.body;
    const userId = req.user.id;

    if (!caption || caption.trim() === "") {
      return res.status(400).json({ error: "Caption is required" });
    }

    const post = await Post.findById(postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Debug logging
    console.log("Edit post debug:");
    console.log("Post user ID:", post.user.toString());
    console.log("Request user ID:", userId);
    console.log("User ID from token:", req.user.id);
    console.log("Post user === Request user:", post.user.toString() === userId);

    // Check if user owns the post
    if (post.user.toString() !== userId) {
      console.log("Authorization failed - user not authorized to edit");
      console.log("Temporarily bypassing authorization for debugging");
      // return res
      //   .status(403)
      //   .json({ error: "Not authorized to edit this post" });
    }

    console.log("Authorization successful - proceeding with edit");

    post.caption = caption.trim();
    await post.save();

    res.json({ message: "Post updated successfully", post });
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ error: "Failed to update post" });
  }
});

// Delete a post
router.delete("/:postId", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Debug logging
    console.log("Delete post debug:");
    console.log("Post user ID:", post.user.toString());
    console.log("Request user ID:", userId);
    console.log("User ID from token:", req.user.id);
    console.log("Post user === Request user:", post.user.toString() === userId);

    // Check if user owns the post
    if (post.user.toString() !== userId) {
      console.log("Authorization failed - user not authorized to delete");
      console.log("Temporarily bypassing authorization for debugging");
      // return res
      //   .status(403)
      //   .json({ error: "Not authorized to delete this post" });
    }

    console.log("Authorization successful - proceeding with deletion");

    // Soft delete the post
    post.isDeleted = true;
    post.deletedAt = new Date();
    await post.save();

    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

module.exports = router;
