const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return !this.group;
      },
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: function () {
        return !this.receiver;
      },
    },
    content: {
      type: String,
      required: function () {
        return !this.attachment; // Content is required only if no attachment
      },
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    messageType: {
      type: String,
      enum: ["text", "image", "video", "file", "system"],
      default: "text",
    },
    // File attachment fields
    attachment: {
      url: {
        type: String,
        default: null,
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
      thumbnail: {
        type: String,
        default: null,
      },
    },
    // For private chats
    chatRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatRoom",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
messageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
messageSchema.index({ receiver: 1, isRead: 1 });
messageSchema.index({ group: 1, timestamp: -1 });
messageSchema.index({ sender: 1, group: 1, timestamp: -1 });

module.exports = mongoose.model("Message", messageSchema);
