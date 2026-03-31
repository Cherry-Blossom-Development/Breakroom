const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'breakroom-uploads';
const BUCKET_REGION = process.env.S3_BUCKET_REGION || process.env.AWS_REGION || 'us-west-2';

// Create S3 client - uses AWS credentials from environment
const s3Client = new S3Client({
  region: BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

/**
 * Upload a file buffer to S3
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {string} key - S3 object key (e.g., 'profiles/profile_123_1703875200.jpg')
 * @param {string} contentType - MIME type (e.g., 'image/jpeg')
 * @returns {Promise<{success: boolean, key?: string, url?: string, error?: string}>}
 */
const uploadToS3 = async (buffer, key, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'max-age=31536000'
    });

    await s3Client.send(command);

    const url = getS3Url(key);
    console.log('S3 upload successful:', key);
    return { success: true, key, url };
  } catch (error) {
    console.error('S3 upload error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a file from S3
 * @param {string} key - S3 object key to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const deleteFromS3 = async (key) => {
  if (!key) return { success: true };

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });

    await s3Client.send(command);
    console.log('S3 delete successful:', key);
    return { success: true };
  } catch (error) {
    console.error('S3 delete error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Get the public URL for an S3 key
 * @param {string} key - S3 object key
 * @returns {string|null} Full S3 URL
 */
const getS3Url = (key) => {
  if (!key) return null;
  return `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${key}`;
};

/**
 * Stream an S3 object through an Express response, supporting range requests.
 * @param {string} key - S3 object key
 * @param {object} req - Express request (reads req.headers.range)
 * @param {object} res - Express response
 */
const streamFromS3 = async (key, req, res) => {
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    // HEAD first to get total size
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    const totalSize = head.ContentLength;
    const contentType = head.ContentType || 'application/octet-stream';

    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : totalSize - 1;
    const chunkSize = end - start + 1;

    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key, Range: `bytes=${start}-${end}` });
    const s3Res = await s3Client.send(command);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    s3Res.Body.pipe(res);
  } else {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const s3Res = await s3Client.send(command);

    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': s3Res.ContentLength,
      'Content-Type': s3Res.ContentType || 'application/octet-stream',
    });
    s3Res.Body.pipe(res);
  }
};

module.exports = {
  uploadToS3,
  deleteFromS3,
  getS3Url,
  streamFromS3,
  BUCKET_NAME
};
