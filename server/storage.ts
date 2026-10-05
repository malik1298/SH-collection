import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface UploadResult {
  url: string;
  publicId?: string;
  format?: string;
  bytes?: number;
  resourceType: 'image' | 'video';
  originalFilename?: string;
}

const SUPPORTED_IMAGE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
];

const SUPPORTED_VIDEO_MIMES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/mov',
  'video/x-matroska',
  'video/ogg',
];

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

function getCloudinaryCredentials() {
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  if (cloudinaryUrl && cloudinaryUrl.startsWith('cloudinary://')) {
    try {
      const parsed = new URL(cloudinaryUrl);
      return {
        cloudName: parsed.hostname,
        apiKey: parsed.username,
        apiSecret: parsed.password,
      };
    } catch (err) {
      console.warn('Invalid CLOUDINARY_URL format:', err);
    }
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }

  return null;
}

export function isCloudStorageConfigured(): boolean {
  return Boolean(getCloudinaryCredentials() || process.env.BLOB_READ_WRITE_TOKEN);
}

export function getUploadSignature(resourceType: 'image' | 'video', filename?: string) {
  const creds = getCloudinaryCredentials();
  if (!creds) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'sh_collection_media';
  const cleanFilename = filename ? path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_') : 'media';
  const publicId = `${cleanFilename}_${Date.now()}`;

  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${creds.apiSecret}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  return {
    endpoint: `https://api.cloudinary.com/v1_1/${creds.cloudName}/${resourceType}/upload`,
    apiKey: creds.apiKey,
    timestamp,
    signature,
    folder,
    publicId,
    cloudName: creds.cloudName,
    resourceType,
  };
}

// Upload file to Cloudinary via official signed REST API
async function uploadToCloudinary(
  dataUrl: string,
  resourceType: 'image' | 'video',
  filename?: string
): Promise<UploadResult> {
  const creds = getCloudinaryCredentials();
  if (!creds) {
    throw new Error('Cloudinary credentials not configured');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'sh_collection_media';
  const cleanFilename = filename ? path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_') : 'media';
  const publicId = `${cleanFilename}_${Date.now()}`;

  // Signature calculation: parameters sorted alphabetically
  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${creds.apiSecret}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  const formData = new FormData();
  formData.append('file', dataUrl);
  formData.append('api_key', creds.apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);
  formData.append('folder', folder);
  formData.append('public_id', publicId);

  const endpoint = `https://api.cloudinary.com/v1_1/${creds.cloudName}/${resourceType}/upload`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || `Cloudinary upload failed with status ${response.status}`);
  }

  return {
    url: data.secure_url,
    publicId: data.public_id,
    format: data.format,
    bytes: data.bytes,
    resourceType,
    originalFilename: filename,
  };
}

// Fallback: Local filesystem / uploads folder
function uploadToLocal(
  dataUrl: string,
  mimeType: string,
  rawBase64: string,
  resourceType: 'image' | 'video',
  filename?: string
): UploadResult {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const uploadsDir = isServerless
    ? path.join('/tmp', 'sh-collection-uploads')
    : path.resolve(process.cwd(), 'uploads');

  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Could not create uploads directory:', err);
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/mov': 'mov',
  };

  const ext = extMap[mimeType] || (resourceType === 'video' ? 'mp4' : 'jpg');
  const safeBase = filename
    ? path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30)
    : resourceType;
  const safeName = `sh-${safeBase}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const filePath = path.join(uploadsDir, safeName);

  const buffer = Buffer.from(rawBase64, 'base64');
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err: any) {
    console.warn('Writing to local uploads failed, falling back to data URL:', err?.message);
    return {
      url: dataUrl,
      resourceType,
      bytes: buffer.length,
      originalFilename: filename,
    };
  }

  const fileUrl = `/uploads/${safeName}`;
  return {
    url: fileUrl,
    resourceType,
    bytes: buffer.length,
    originalFilename: filename,
  };
}

// Master Media Upload Processor with Strict Validation & Production Routing
export async function processMediaUpload(
  dataUrl: string,
  filename?: string,
  requestedType?: 'image' | 'video'
): Promise<UploadResult> {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('No media data provided for upload.');
  }

  // If already a valid HTTPS URL, return directly
  if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    const isVideo =
      requestedType === 'video' ||
      /\.(mp4|webm|mov|ogg)($|\?)/i.test(dataUrl);
    return {
      url: dataUrl,
      resourceType: isVideo ? 'video' : 'image',
      originalFilename: filename,
    };
  }

  const matches = dataUrl.match(/^data:([A-Za-z-+\/0-9]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid file format. Upload requires valid image or video data.');
  }

  const mimeType = matches[1].toLowerCase();
  const rawBase64 = matches[2];
  const approximateBytes = Math.round((rawBase64.length * 3) / 4);

  const isImage = SUPPORTED_IMAGE_MIMES.includes(mimeType);
  const isVideo = SUPPORTED_VIDEO_MIMES.includes(mimeType);

  if (!isImage && !isVideo) {
    if (requestedType === 'video' || mimeType.startsWith('video/')) {
      throw new Error(
        'Please select a supported video file (MP4, WebM, or MOV).'
      );
    }
    throw new Error(
      'Please select a valid image file (JPG, PNG, WEBP, or GIF).'
    );
  }

  const resourceType: 'image' | 'video' = isVideo ? 'video' : 'image';

  // Check size limits
  if (isImage && approximateBytes > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image size (${(approximateBytes / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 15MB.`
    );
  }

  if (isVideo && approximateBytes > MAX_VIDEO_BYTES) {
    throw new Error(
      `Video size (${(approximateBytes / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 100MB.`
    );
  }

  // 1. Try Cloudinary if credentials are configured
  if (getCloudinaryCredentials()) {
    try {
      return await uploadToCloudinary(dataUrl, resourceType, filename);
    } catch (cloudErr: any) {
      console.error('[Storage Error] Cloudinary upload failed, attempting fallback:', cloudErr?.message);
    }
  }

  // 2. Fallback to Local Storage / uploads directory
  return uploadToLocal(dataUrl, mimeType, rawBase64, resourceType, filename);
}

// Media Cleanup / Deletion (Optional)
export async function deleteMediaByUrl(mediaUrl: string): Promise<boolean> {
  if (!mediaUrl) return false;

  // Cloudinary deletion
  const creds = getCloudinaryCredentials();
  if (creds && mediaUrl.includes('cloudinary.com')) {
    try {
      const match = mediaUrl.match(/sh_collection_media\/([^.]+)/);
      if (match && match[0]) {
        const publicId = match[0];
        const timestamp = Math.floor(Date.now() / 1000);
        const resourceType = mediaUrl.includes('/video/upload/') ? 'video' : 'image';
        const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}${creds.apiSecret}`;
        const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

        const formData = new FormData();
        formData.append('public_id', publicId);
        formData.append('api_key', creds.apiKey);
        formData.append('timestamp', timestamp.toString());
        formData.append('signature', signature);

        await fetch(`https://api.cloudinary.com/v1_1/${creds.cloudName}/${resourceType}/destroy`, {
          method: 'POST',
          body: formData,
        });
        return true;
      }
    } catch (err) {
      console.warn('Cloudinary delete error:', err);
    }
  }

  // Local deletion
  if (mediaUrl.startsWith('/uploads/')) {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const uploadsDir = isServerless
      ? path.join('/tmp', 'sh-collection-uploads')
      : path.resolve(process.cwd(), 'uploads');
    const safeName = path.basename(mediaUrl);
    const filePath = path.join(uploadsDir, safeName);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch (err) {
      console.warn('Local file unlink error:', err);
    }
  }

  return true;
}
