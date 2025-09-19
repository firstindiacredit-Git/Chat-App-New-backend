const mongoose = require("mongoose");

const chatRoomSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // For future group chat features
    roomType: {
      type: String,
      enum: ["private", "group"],
      default: "private",
    },
    roomName: {
      type: String,
      default: null,
    },
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Ensure only 2 participants for private chats
chatRoomSchema.pre("save", function (next) {
  if (this.roomType === "private" && this.participants.length !== 2) {
    return next(
      new Error("Private chat rooms must have exactly 2 participants")
    );
  }
  next();
});

// Index for efficient querying
chatRoomSchema.index({ participants: 1, lastActivity: -1 });
chatRoomSchema.index({ "participants.0": 1, "participants.1": 1 });

module.exports = mongoose.model("ChatRoom", chatRoomSchema);
