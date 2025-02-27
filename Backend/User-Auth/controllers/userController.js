import User from "../models/userModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "crypto";
import mongoose from "mongoose";

// Define TempUser schema for storing temporary signup data
const tempUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  verificationToken: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: "30m" } // Auto-expire after 30 minutes
});

const TempUser = mongoose.model("TempUser", tempUserSchema);

export const initiateSignUp = async (req, res) => {
  const { email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  let existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ message: "User Already Exists" });
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");

  // Save to TempUser collection instead of Map
  await TempUser.create({
    email,
    password,
    verificationToken,
  });

  const verificationLink = `https://ironcore-gym-2.onrender.com/verify-email/${verificationToken}?email=${encodeURIComponent(email)}`;
  const backendVerificationEndpoint = `https://authentication-backend-kbui.onrender.com/api/user/verify-email/${verificationToken}?email=${encodeURIComponent(email)}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Email Verification - IRONCORE GYM",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; text-align: center;">Welcome to IRONCORE GYM!</h2>
          <div style="background-color: #f8f8f8; padding: 20px; border-radius: 8px;">
            <p style="color: #555;">Please click the button below to verify your email address:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationLink}"
                style="background-color: #4CAF50; color: white; padding: 12px 25px;
                  text-decoration: none; border-radius: 4px; display: inline-block;">
                Verify Email Address
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">This link will expire in 30 minutes.</p>
            <p style="color: #888; font-size: 12px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="background-color: #eee; padding: 10px; word-break: break-all; font-size: 12px;">
              ${verificationLink}
            </p>
          </div>
        </div>
      `,
    });

    res.json({
      success: true,
      message:
        "Verification email sent! Please check your inbox (and spam folder) to verify your account. You'll be redirected to login after verification.",
    });
  } catch (error) {
    console.error("Error sending verification email:", error);
    res.status(500).json({ message: "Error sending verification email" });
  }
};

export const verifyEmail = async (req, res) => {
  const { token } = req.params;
  const { email } = req.query;

  if (!email || !token) {
    return res.status(400).json({
      success: false,
      message: "Invalid verification link",
    });
  }

  // Find temp user in MongoDB
  const tempUser = await TempUser.findOne({ email, verificationToken: token });

  if (!tempUser) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired verification link",
    });
  }

  // No need to check expiry manually since MongoDB handles it with TTL
  try {
    const user = await User.create({
      email: tempUser.email,
      password: tempUser.password,
      isVerified: true,
    });

    await TempUser.deleteOne({ _id: tempUser._id });

    const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      token,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying email. Please try again.",
    });
  }
};

// Rest of the controllers remain unchanged
export const signIn = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "Invalid Email or Password" });

  if (!user.isVerified) {
    return res.status(400).json({ message: "Please verify your email before logging in" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ message: "Invalid Email or Password" });

  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

  res
    .status(200)
    .cookie("token", token, { httpOnly: true, sameSite: "None", secure: true })
    .json({ success: true, message: "Login successful!", token });
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const tempOTPs = new Map(); // Keeping this as Map since forgot password works fine
    tempOTPs.set(email, {
      otp,
      createdAt: new Date(),
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP - IRONCORE GYM",
      html: `
        <h2>Password Reset Request</h2>
        <p>Your One-Time Password (OTP) for password reset is:</p>
        <h3>${otp}</h3>
        <p>This OTP will expire in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });

    res.json({ message: "OTP sent to your email successfully" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Error sending OTP" });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const tempOTPs = new Map(); // Keeping this as Map since it works
    const otpData = tempOTPs.get(email);

    if (!otpData) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (new Date() - otpData.createdAt > 15 * 60 * 1000) {
      tempOTPs.delete(email);
      return res.status(400).json({ message: "OTP expired" });
    }

    if (otpData.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    tempOTPs.set(email, { ...otpData, resetToken });

    res.json({
      message: "OTP verified successfully",
      resetToken,
    });
  } catch (error) {
    res.status(500).json({ message: "Error verifying OTP" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { resetToken, password } = req.body;

    const tempOTPs = new Map(); // Keeping this as Map since it works
    let userEmail = null;
    let otpData = null;

    for (const [email, data] of tempOTPs.entries()) {
      if (data.resetToken === resetToken) {
        userEmail = email;
        otpData = data;
        break;
      }
    }

    if (!userEmail || !otpData) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    if (new Date() - otpData.createdAt > 15 * 60 * 1000) {
      tempOTPs.delete(userEmail);
      return res.status(400).json({ message: "Reset token expired" });
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.password = password;
    await user.save();

    tempOTPs.delete(userEmail);

    res.json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ message: "Error resetting password" });
  }
};

export const getUserInfo = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user info:", error);
    res.status(500).json({ message: "Error fetching user information" });
  }
};