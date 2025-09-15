const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    bio: {
      type: String,
      default: "",
    },
    avatar: {
      type: String,
      default: "",
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      code: String,
      expiresAt: Date,
    },
    resetToken: {
      token: String,
      expiresAt: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ "otp.expiresAt": 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("User", userSchema);
