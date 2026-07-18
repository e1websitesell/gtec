// Cloudinary-তে ছবি/ভিডিও আপলোড করার হেল্পার (unsigned upload preset ব্যবহার করে)

const CLOUD_NAME = "dj4uyo4rv";
const UPLOAD_PRESET = "hostelupload";

export async function uploadToCloudinary(file) {
  const isVideo = file.type.startsWith("video/");
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${isVideo ? "video" : "image"}/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const res = await fetch(endpoint, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Cloudinary আপলোড ব্যর্থ হয়েছে");
  const data = await res.json();
  return { url: data.secure_url, type: isVideo ? "video" : "image" };
}
