// Ticket attachments (migration 085): files stored in S3 under
// tickets/<ticket id>/, referenced by ticket_attachments rows. Files are
// never linked from S3 directly; routes/helpdesk.js streams them after
// checking ticket access.
const path = require('path');
const multer = require('multer');

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;

// Raster images are shown inline (previews); everything else is served as
// a download. Never inline HTML/SVG/etc: served from our own origin they
// could run script.
const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD }
}).array('files', MAX_FILES_PER_UPLOAD);

// multer as a middleware that answers 400 (not 500) for oversize/too many
function uploadFiles(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Each file must be ${MAX_FILE_BYTES / 1024 / 1024} MB or smaller`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Attach at most ${MAX_FILES_PER_UPLOAD} files at a time`
          : err.message;
      return res.status(400).json({ message });
    }
    next(err);
  });
}

// Busboy hands multipart filenames over as latin1; recover UTF-8 and strip
// anything path-like
function cleanFileName(originalName) {
  let name = Buffer.from(originalName || '', 'latin1').toString('utf8');
  name = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f"]/g, '').trim();
  return (name || 'file').slice(0, 255);
}

function isInlineType(contentType) {
  return INLINE_TYPES.includes(contentType);
}

// Content-Disposition with an ASCII fallback plus the UTF-8 name (RFC 6266)
function contentDisposition(fileName, inline) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const ATTACHMENT_COLUMNS = `a.id, a.ticket_id, a.file_name, a.content_type, a.size_bytes, a.created_at,
  a.uploaded_by, u.handle as uploader_handle`;

async function getTicketAttachments(client, ticketId) {
  const result = await client.query(
    `SELECT ${ATTACHMENT_COLUMNS}
     FROM ticket_attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.ticket_id = $1
     ORDER BY a.created_at, a.id`,
    [ticketId]
  );
  return result.rows.map(a => ({ ...a, is_image: isInlineType(a.content_type) }));
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  uploadFiles,
  cleanFileName,
  isInlineType,
  contentDisposition,
  getTicketAttachments
};
