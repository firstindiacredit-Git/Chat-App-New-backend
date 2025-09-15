const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Create transporter for sending emails
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "your-email@gmail.com",
    pass: process.env.EMAIL_PASSWORD || "your-app-password",
  },
  tls: {
    rejectUnauthorized: false,
  },
  debug: false, // Disable debug output
  logger: false, // Disable console logging
});

// Verify transporter configuration
transporter.verify(function (error, success) {
  if (error) {
    console.error("Email transporter verification failed:", error);
    console.error(
      "Please check your EMAIL_USER and EMAIL_PASSWORD in .env file"
    );
  } else {
    console.log("✅ Email server is ready to send messages");
  }
});

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate reset token
const generateResetToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// Send OTP email for login/signup verification
const sendOTPEmail = async (email, otp, type = "verification") => {
  try {
    console.log("📧 Email configuration:", {
      user: process.env.EMAIL_USER || "not-set",
      hasPassword: !!process.env.EMAIL_PASSWORD,
      to: email,
      otp: otp,
      type: type,
    });

    const subject =
      type === "login"
        ? "Login Verification Code - ChatApp"
        : "Email Verification Code - ChatApp";

    const mailOptions = {
      from: process.env.EMAIL_USER || "your-email@gmail.com",
      to: email,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #25D366, #128C7E); color: white; padding: 30px; border-radius: 10px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">${
              type === "login" ? "Login Verification" : "Email Verification"
            }</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Your verification code is:</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; margin-top: 20px; text-align: center;">
            <div style="background: white; border: 2px dashed #25D366; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h2 style="color: #25D366; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h2>
            </div>
            <p style="color: #666; margin: 20px 0 0 0; font-size: 14px;">
              This code will expire in 10 minutes. If you didn't request this, please ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>ChatApp</p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      `,
    };

    console.log("📤 Sending email with options:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });

    const result = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully:", result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("❌ Email sending error:", error);
    console.error("Error details:", {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
    });
    return { success: false, error: error.message };
  }
};

module.exports = {
  generateOTP,
  generateResetToken,
  sendOTPEmail,
};
