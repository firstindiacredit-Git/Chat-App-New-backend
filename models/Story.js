const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      trim: true,
    },
    media: {
      type: String, // URL to image/video
      default: "",
    },
    mediaType: {
      type: String,
      enum: ["image", "video", "text"],
      default: "text",
    },
    backgroundColor: {
      type: String,
      default: "#25D366",
    },
    textColor: {
      type: String,
      default: "#ffffff",
    },
    textSize: {
      type: String,
      enum: ["small", "medium", "large"],
      default: "medium",
    },
    views: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      index: { expireAfterSeconds: 0 }, // Auto-delete after expiration
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
storySchema.index({ author: 1, expiresAt: 1 });
storySchema.index({ expiresAt: 1 });
storySchema.index({ "views.user": 1 });

// Virtual for view count
storySchema.virtual("viewCount").get(function () {
  return this.views.length;
});

// Method to add a view
storySchema.methods.addView = function (userId) {
  // Check if user already viewed this story
  const existingView = this.views.find(
    (view) => view.user.toString() === userId.toString()
  );

  if (!existingView) {
    this.views.push({ user: userId });
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to check if user has viewed this story
storySchema.methods.hasUserViewed = function (userId) {
  return this.views.some((view) => view.user.toString() === userId.toString());
};

module.exports = mongoose.model("Story", storySchema);
