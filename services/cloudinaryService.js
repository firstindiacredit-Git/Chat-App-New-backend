const cloudinary = require("cloudinary").v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload image to Cloudinary
const uploadImage = async (fileBuffer, folder = "chatapp-avatars") => {
  try {
    // Convert buffer to base64 string for Cloudinary
    const base64String = `data:image/jpeg;base64,${fileBuffer.toString(
      "base64"
    )}`;

    // Different transformations for different folders
    let transformation = [];
    let publicIdPrefix = "avatar";

    if (folder === "posts") {
      // For posts, keep original aspect ratio but limit size
      transformation = [
        { width: 1200, height: 1200, crop: "limit" },
        { quality: "auto", fetch_format: "auto" },
      ];
      publicIdPrefix = "post";
    } else {
      // For avatars, crop to square
      transformation = [
        { width: 400, height: 400, crop: "fill", gravity: "face" },
        { quality: "auto", fetch_format: "auto" },
      ];
    }

    const result = await cloudinary.uploader.upload(base64String, {
      folder: folder,
      resource_type: "auto",
      transformation: transformation,
      public_id: `${publicIdPrefix}_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
    });

    return {
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// Delete image from Cloudinary
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return {
      success: result.result === "ok",
      result: result.result,
    };
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  uploadImage,
  deleteImage,
};
