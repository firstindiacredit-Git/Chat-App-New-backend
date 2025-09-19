const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    caption: {
      type: String,
      default: "",
      trim: true,
    },
    image: {
      url: {
        type: String,
        required: true,
      },
      publicId: {
        type: String,
        required: true,
      },
      filename: {
        type: String,
        default: null,
      },
      originalName: {
        type: String,
        default: null,
      },
      mimeType: {
        type: String,
        default: null,
      },
      size: {
        type: Number,
        default: null,
      },
    },
    likes: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        text: {
          type: String,
          required: true,
          trim: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Post visibility settings
    isPublic: {
      type: Boolean,
      default: true,
    },
    // Deletion status
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ "likes.user": 1 });
postSchema.index({ "comments.user": 1 });

// Method to add a like (prevents duplicates)
postSchema.methods.addLike = function (userId) {
  const existingLike = this.likes.find(
    (like) => like.user.toString() === userId
  );
  if (!existingLike) {
    this.likes.push({ user: userId });
  }
  return this;
};

// Method to remove a like
postSchema.methods.removeLike = function (userId) {
  this.likes = this.likes.filter((like) => like.user.toString() !== userId);
  return this;
};

// Method to check if user has liked
postSchema.methods.hasUserLiked = function (userId) {
  return this.likes.some((like) => like.user.toString() === userId);
};

// Pre-save middleware to prevent duplicate likes
postSchema.pre("save", function (next) {
  if (this.isModified("likes")) {
    // Remove duplicate likes from the same user
    const uniqueLikes = [];
    const seenUsers = new Set();

    for (const like of this.likes) {
      const userId = like.user.toString();
      if (!seenUsers.has(userId)) {
        seenUsers.add(userId);
        uniqueLikes.push(like);
      }
    }

    this.likes = uniqueLikes;
  }
  next();
});

// Virtual for like count
postSchema.virtual("likeCount").get(function () {
  return this.likes.length;
});

// Virtual for comment count
postSchema.virtual("commentCount").get(function () {
  return this.comments.length;
});

// Ensure virtual fields are serialized
postSchema.set("toJSON", { virtuals: true });
postSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Post", postSchema);
