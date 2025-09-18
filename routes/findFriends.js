const express = require("express");
const router = express.Router();
const User = require("../models/User");
const jwt = require("jsonwebtoken");

// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

// Sync contacts and find friends (Enhanced for web and native)
router.post("/sync-contacts", verifyToken, async (req, res) => {
  try {
    const { contacts, platform, method } = req.body;
    const currentUserId = req.user.userId;

    console.log("📱 Find Friends - Sync contacts request:", {
      userId: currentUserId,
      contactsCount: contacts?.length || 0,
      platform: platform || "unknown",
      method: method || "unknown",
    });

    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json({
        success: false,
        message: "Contacts array is required",
      });
    }

    // Extract all phone numbers from contacts
    const phoneNumbers = [];
    const contactMap = new Map(); // Map phone to contact info

    contacts.forEach((contact) => {
      if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
        contact.phoneNumbers.forEach((phone) => {
          const cleanPhone = phone.replace(/\D/g, "");
          if (cleanPhone.length >= 10) {
            phoneNumbers.push(cleanPhone);
            contactMap.set(cleanPhone, {
              name: contact.name,
              phone: phone,
              originalPhone: cleanPhone,
            });
          }
        });
      }
    });

    console.log("📱 Processed contacts:", {
      totalContacts: contacts.length,
      extractedPhones: phoneNumbers.length,
      samplePhones: phoneNumbers.slice(0, 3),
    });

    // Enhanced phone number matching
    const processPhoneNumbers = (phones) => {
      const processed = new Set();

      phones.forEach((phone) => {
        // Add original number
        processed.add(phone);

        // Add variations for better matching
        if (phone.length === 10) {
          // Add with country codes
          processed.add("91" + phone); // Indian
          processed.add("1" + phone); // US
        } else if (phone.length === 12 && phone.startsWith("91")) {
          // Indian format - also add without country code
          processed.add(phone.substring(2));
        } else if (phone.length === 11 && phone.startsWith("1")) {
          // US format - also add without country code
          processed.add(phone.substring(1));
        }

        // Also add last 10 digits for any long number
        if (phone.length > 10) {
          processed.add(phone.substring(phone.length - 10));
        }
      });

      return Array.from(processed);
    };

    const searchPhones = processPhoneNumbers(phoneNumbers);

    // Find app users with matching phone numbers
    const appUsers = await User.find(
      {
        phone: { $in: searchPhones },
        isEmailVerified: true,
        _id: { $ne: currentUserId }, // Exclude current user
      },
      {
        name: 1,
        _id: 1,
        avatar: 1,
        phone: 1,
        bio: 1,
        email: 1,
      }
    );

    console.log("📱 Found app users:", appUsers.length);

    // Match app users with contact names
    const appUsersWithContactInfo = appUsers.map((user) => {
      const userPhone = user.phone.replace(/\D/g, "");

      // Find matching contact
      let matchingContact = null;
      for (let [phone, contactInfo] of contactMap) {
        if (
          phone === userPhone ||
          phone.endsWith(userPhone.slice(-10)) ||
          userPhone.endsWith(phone.slice(-10))
        ) {
          matchingContact = contactInfo;
          break;
        }
      }

      return {
        ...user.toObject(),
        contactName: matchingContact?.name || null,
        contactPhone: matchingContact?.phone || user.phone,
        isInContacts: !!matchingContact,
      };
    });

    // Separate contacts who are NOT using the app
    const nonAppContacts = contacts.filter((contact) => {
      if (!contact.phoneNumbers || contact.phoneNumbers.length === 0)
        return false;

      // Check if any phone number matches an app user
      const hasMatchingAppUser = contact.phoneNumbers.some((phone) => {
        const cleanPhone = phone.replace(/\D/g, "");
        return appUsers.some((user) => {
          const userPhone = user.phone.replace(/\D/g, "");
          return (
            cleanPhone === userPhone ||
            cleanPhone.endsWith(userPhone.slice(-10)) ||
            userPhone.endsWith(cleanPhone.slice(-10))
          );
        });
      });

      return !hasMatchingAppUser;
    });

    console.log("📱 Contact analysis:", {
      appUsers: appUsersWithContactInfo.length,
      nonAppContacts: nonAppContacts.length,
      totalProcessed: contacts.length,
    });

    res.json({
      success: true,
      message: "Contacts synced successfully",
      data: {
        appUsers: appUsersWithContactInfo,
        nonAppContacts: nonAppContacts,
        totalContacts: contacts.length,
        appUsersCount: appUsersWithContactInfo.length,
        nonAppContactsCount: nonAppContacts.length,
        syncTimestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Sync contacts error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Web contact sync (for web platform when native not available)
router.post("/sync-web-contacts", verifyToken, async (req, res) => {
  try {
    const { phoneNumbers } = req.body;
    const currentUserId = req.user.userId;

    console.log("📱 App Contact Sync request:", {
      userId: currentUserId,
      phoneCount: phoneNumbers?.length || 0,
    });

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res.status(400).json({
        success: false,
        message: "Phone numbers array is required for app sync",
      });
    }

    // Process phone numbers for web sync
    const cleanedPhones = phoneNumbers
      .map((phone) => phone.replace(/\D/g, ""))
      .filter((phone) => phone.length >= 10);

    console.log("📱 Web sync processed phones:", {
      original: phoneNumbers.length,
      cleaned: cleanedPhones.length,
    });

    if (cleanedPhones.length === 0) {
      return res.json({
        success: true,
        message: "No valid phone numbers provided",
        data: {
          appUsers: [],
          totalContacts: 0,
          method: "native",
        },
      });
    }

    // Find matching app users
    const appUsers = await User.find(
      {
        phone: { $in: cleanedPhones },
        isEmailVerified: true,
        _id: { $ne: currentUserId },
      },
      {
        name: 1,
        _id: 1,
        avatar: 1,
        phone: 1,
        bio: 1,
      }
    );

    console.log("📱 App sync found app users:", appUsers.length);

    res.json({
      success: true,
      message: `App contact sync completed`,
      data: {
        appUsers: appUsers,
        totalContacts: phoneNumbers.length,
        foundCount: appUsers.length,
        method: "native",
        syncTimestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("App contact sync error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get all app users (for users without contacts)
router.get("/app-users", verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;

    const users = await User.find(
      {
        isEmailVerified: true,
        _id: { $ne: currentUserId },
      },
      {
        name: 1,
        _id: 1,
        avatar: 1,
        phone: 1,
        bio: 1,
      }
    )
      .sort({ name: 1 })
      .limit(50);

    res.json({
      success: true,
      message: "App users retrieved successfully",
      data: {
        users,
        count: users.length,
      },
    });
  } catch (error) {
    console.error("Get app users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Send invitation
router.post("/send-invitation", verifyToken, async (req, res) => {
  try {
    const { contactName, phoneNumber, invitationMethod } = req.body;
    const currentUserId = req.user.userId;

    // Get current user info
    const currentUser = await User.findById(currentUserId, {
      name: 1,
      phone: 1,
    });

    console.log("📱 Invitation request:", {
      from: currentUser.name,
      to: contactName,
      phone: phoneNumber,
      method: invitationMethod,
    });

    // Here you can implement actual invitation logic
    // For now, we'll just log and return success

    res.json({
      success: true,
      message: "Invitation sent successfully",
      data: {
        contactName,
        phoneNumber,
        invitedBy: currentUser.name,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Send invitation error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
