const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    avatar: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    members: [
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
    settings: {
      allowMemberInvite: {
        type: Boolean,
        default: true,
      },
      onlyAdminsCanSendMessages: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Ensure creator is added as admin and member
groupSchema.pre("save", function (next) {
  if (this.isNew) {
    // Add creator as admin and member
    if (!this.admins.includes(this.createdBy)) {
      this.admins.push(this.createdBy);
    }
    if (!this.members.includes(this.createdBy)) {
      this.members.push(this.createdBy);
    }
  }
  next();
});

// Index for efficient querying
groupSchema.index({ members: 1, lastActivity: -1 });
groupSchema.index({ createdBy: 1 });
groupSchema.index({ isActive: 1 });

module.exports = mongoose.model("Group", groupSchema);
