require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createRedisClients } = require('./utilities/redis');

const app = express();
const server = http.createServer(app);
const port = 3000;

// Set up Socket.IO - allow multiple origins
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  'https://prosaurus.com',
  'https://www.prosaurus.com'
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

// Initialize Socket.IO with Redis adapter
(async () => {
  try {
    const { pubClient, subClient } = await createRedisClients();
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter initialized');
  } catch (err) {
    console.error('Redis adapter failed, using in-memory:', err.message);
  }

  const { initializeSocket } = require('./utilities/socket');
  initializeSocket(io);
})();

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));


app.set('view engine', 'ejs');

const authentication = require('./routes/authentication');
const user = require('./routes/user');
const permissionRoutes = require('./routes/permission');
const groupRoutes = require('./routes/group');
const chatRoutes = require('./routes/chat');
const profileRoutes = require('./routes/profile');
const breakroomRoutes = require('./routes/breakroom');
const friendsRoutes = require('./routes/friends');
const blogRoutes = require('./routes/blog');
const helpdeskRoutes = require('./routes/helpdesk');
const companyRoutes = require('./routes/company');
const positionsRoutes = require('./routes/positions');
const notificationRoutes = require('./routes/notification');
const systemEmailRoutes = require('./routes/system-emails');
const commentsRoutes = require('./routes/comments');
const projectsRoutes = require('./routes/projects');
const shortcutsRoutes = require('./routes/shortcuts');
const testResultsRoutes = require('./routes/test-results');
const lyricsRoutes = require('./routes/lyrics');
const galleryRoutes = require('./routes/gallery');
const { getS3Url } = require('./utilities/aws-s3');



// Middleware to parse incoming JSON data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sliding session — refresh the JWT on every authenticated request
const refreshSession = require('./middleware/refreshSession');
app.use(refreshSession);

// Use routes
app.use('/api/auth', authentication);
app.use('/api/user', user);
app.use('/api/permission', permissionRoutes);
app.use('/api/group', groupRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/breakroom', breakroomRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/helpdesk', helpdeskRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/positions', positionsRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/system-emails', systemEmailRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/shortcuts', shortcutsRoutes);
app.use('/api/test-results', testResultsRoutes);
app.use('/api/lyrics', lyricsRoutes);
app.use('/api/gallery', galleryRoutes);

// Redirect uploaded file requests to S3
const handleS3Redirect = (req, res) => {
  // req.path is relative to mount point, so /api/uploads/chat/file.jpg becomes /chat/file.jpg
  const key = req.path.replace(/^\//, ''); // Remove leading slash
  if (!key) {
    return res.status(404).json({ message: 'File not found' });
  }
  // Handle both new S3 keys (profiles/..., chat/..., blog/..., gallery/...) and legacy filenames
  let s3Key = key;
  if (!key.startsWith('profiles/') && !key.startsWith('chat/') && !key.startsWith('blog/') && !key.startsWith('gallery/')) {
    // Legacy filename - add appropriate prefix
    if (key.startsWith('profile_')) {
      s3Key = `profiles/${key}`;
    } else if (key.startsWith('chat_')) {
      s3Key = `chat/${key}`;
    }
  }
  res.redirect(301, getS3Url(s3Key));
};
app.use('/uploads', handleS3Redirect);
app.use('/api/uploads', handleS3Redirect);


// Serve frontend static files
app.use(express.static(path.join(__dirname, 'dist')));


// Open Graph meta tag injection for public blog URLs
const indexHtmlPath = path.join(__dirname, 'dist', 'index.html');
const { getClient } = require('./utilities/db');

function getIndexHtml() {
  // Production: read from dist
  try {
    return fs.readFileSync(indexHtmlPath, 'utf8');
  } catch (err) {
    // Local dev: dist doesn't exist, return a minimal shell
    return `<!DOCTYPE html>
<html lang="">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prosaurus Breakroom</title>
  </head>
  <body>
    <div id="app"></div>
    <script>window.location.href = window.location.href;</script>
  </body>
</html>`;
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractFirstImage(html) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function buildOgTags({ title, description, url, image, siteName, authorName }) {
  let tags = `
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${escapeHtml(siteName)}" />
    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="description" content="${escapeHtml(description)}" />`;
  if (authorName) {
    tags += `\n    <meta name="author" content="${escapeHtml(authorName)}" />`;
  }
  if (image) {
    tags += `\n    <meta property="og:image" content="${escapeHtml(image)}" />`;
    tags += `\n    <meta name="twitter:image" content="${escapeHtml(image)}" />`;
  }
  return tags;
}

function injectOgIntoHtml(html, ogTags, title) {
  let result = html.replace('</head>', ogTags + '\n  </head>');
  if (title) {
    result = result.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  }
  return result;
}

async function handleBlogOg(req, res) {
  const { blogUrl, postId } = req.params;
  const baseUrl = process.env.CORS_ORIGIN || 'https://www.prosaurus.com';

  const indexHtml = getIndexHtml();

  let client;
  try {
    client = await getClient();

    // Fetch blog info
    const blogResult = await client.query(
      `SELECT ub.blog_url, ub.blog_name, ub.user_id,
              u.handle, u.first_name, u.last_name, u.photo_path
       FROM user_blog ub
       JOIN users u ON ub.user_id = u.id
       WHERE ub.blog_url = $1`,
      [blogUrl]
    );

    if (blogResult.rowCount === 0) {
      // Blog not found — serve plain index.html, let SPA handle the 404
      return res.send(indexHtml);
    }

    const blog = blogResult.rows[0];
    const authorName = [blog.first_name, blog.last_name].filter(Boolean).join(' ') || blog.handle;

    if (postId) {
      // Specific post
      const postResult = await client.query(
        `SELECT id, title, content FROM blog_posts
         WHERE id = $1 AND user_id = $2 AND is_published = TRUE`,
        [postId, blog.user_id]
      );

      if (postResult.rowCount === 0) {
        return res.send(indexHtml);
      }

      const post = postResult.rows[0];
      const plainText = stripHtml(post.content || '');
      const description = plainText.length > 200 ? plainText.substring(0, 197) + '...' : plainText;
      let image = extractFirstImage(post.content || '');
      if (image && image.startsWith('/')) {
        image = baseUrl + image;
      }

      const ogTags = buildOgTags({
        title: post.title,
        description: description || `A post on ${blog.blog_name}`,
        url: `${baseUrl}/b/${blogUrl}/${post.id}`,
        image,
        siteName: 'Prosaurus Breakroom',
        authorName
      });

      const html = injectOgIntoHtml(indexHtml, ogTags, `${post.title} - Prosaurus Breakroom`);
      return res.send(html);
    } else {
      // Blog landing page
      const ogTags = buildOgTags({
        title: blog.blog_name,
        description: `${blog.blog_name} by ${authorName} on Prosaurus Breakroom`,
        url: `${baseUrl}/b/${blogUrl}`,
        image: blog.photo_path ? `${baseUrl}/api/uploads/${blog.photo_path}` : null,
        siteName: 'Prosaurus Breakroom',
        authorName
      });

      const html = injectOgIntoHtml(indexHtml, ogTags, `${blog.blog_name} - Prosaurus Breakroom`);
      return res.send(html);
    }
  } catch (err) {
    console.error('Error generating OG tags for blog:', err);
    // On any error, serve the plain index.html so the page still works
    return res.send(indexHtml);
  } finally {
    if (client) client.release();
  }
}

app.get('/b/:blogUrl/:postId', handleBlogOg);
app.get('/b/:blogUrl', handleBlogOg);

// OG tags for /blog/view/:id (authenticated blog view URL users are likely to share)
app.get('/blog/view/:id', async (req, res) => {
  const { id } = req.params;
  const baseUrl = process.env.CORS_ORIGIN || 'https://www.prosaurus.com';
  const indexHtml = getIndexHtml();

  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT bp.id, bp.title, bp.content,
              u.handle, u.first_name, u.last_name, u.photo_path,
              ub.blog_url, ub.blog_name
       FROM blog_posts bp
       JOIN users u ON bp.user_id = u.id
       LEFT JOIN user_blog ub ON ub.user_id = u.id
       WHERE bp.id = $1 AND bp.is_published = TRUE`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.send(indexHtml);
    }

    const post = result.rows[0];
    const authorName = [post.first_name, post.last_name].filter(Boolean).join(' ') || post.handle;
    const plainText = stripHtml(post.content || '');
    const description = plainText.length > 200 ? plainText.substring(0, 197) + '...' : plainText;
    let image = extractFirstImage(post.content || '');
    if (image && image.startsWith('/')) {
      image = baseUrl + image;
    }

    const ogTags = buildOgTags({
      title: post.title,
      description: description || `A post on Prosaurus Breakroom`,
      url: `${baseUrl}/blog/view/${post.id}`,
      image,
      siteName: 'Prosaurus Breakroom',
      authorName
    });

    const html = injectOgIntoHtml(indexHtml, ogTags, `${post.title} - Prosaurus Breakroom`);
    return res.send(html);
  } catch (err) {
    console.error('Error generating OG tags for blog view:', err);
    return res.send(indexHtml);
  } finally {
    if (client) client.release();
  }
});

// OG tags for /privacy
app.get('/privacy', (req, res) => {
  const baseUrl = process.env.CORS_ORIGIN || 'https://www.prosaurus.com';
  const indexHtml = getIndexHtml();
  const ogTags = buildOgTags({
    title: 'Privacy Policy',
    description: 'Privacy Policy for the Prosaurus iOS app, provided by Cherry Blossom Development LLC.',
    url: `${baseUrl}/privacy`,
    image: null,
    siteName: 'Prosaurus'
  });
  const html = injectOgIntoHtml(indexHtml, ogTags, 'Privacy Policy - Prosaurus');
  return res.send(html);
});

// Serve index.html for all non-API, non-static requests
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next(); // let API routes handle their paths
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

console.log('Serving static from:', path.join(__dirname, 'dist'));
console.log('Fallback route will catch anything not under /api');

server.listen(port, () => {
  console.log(`App running on ${process.env.CORS_ORIGIN}:${port}`);
  console.log('Socket.IO server is ready');
});

