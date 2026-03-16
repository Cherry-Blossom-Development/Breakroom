const jwt = require('jsonwebtoken');
const { getClient } = require('./db');
const { checkAndFilterContent } = require('./contentFilter');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Store socket connections by user ID
const userSockets = new Map();

// Store io instance for use in other modules
let ioInstance = null;

const getIO = () => ioInstance;

const initializeSocket = (io) => {
  ioInstance = io;

  // Middleware to authenticate socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.split('jwtToken=')[1]?.split(';')[0];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = jwt.verify(token, SECRET_KEY);

      // Get user from database
      const client = await getClient();
      const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
      client.release();

      if (user.rowCount === 0) {
        return next(new Error('User not found'));
      }

      socket.user = {
        id: user.rows[0].id,
        handle: user.rows[0].handle
      };

      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.handle} (socket: ${socket.id})`);

    // Join user-specific room for notifications (works with multiple tabs and Redis adapter)
    socket.join(`user_${socket.user.id}`);

    // Store socket reference (kept for chat functionality)
    userSockets.set(socket.user.id, socket);

    // Join a chat room
    socket.on('join_room', async (roomId) => {
      const client = await getClient();
      try {
        // Verify room exists
        const room = await client.query('SELECT id, name, owner_id FROM chat_rooms WHERE id = $1 AND is_active = true', [roomId]);
        if (room.rowCount === 0) {
          socket.emit('error', { message: 'Chat room not found' });
          return;
        }

        // Check membership (General room is public, others require membership)
        if (room.rows[0].owner_id !== null) {
          const membership = await client.query(
            'SELECT 1 FROM users_rooms WHERE user_id = $1 AND room_id = $2 AND accepted = true',
            [socket.user.id, roomId]
          );
          if (membership.rowCount === 0) {
            socket.emit('error', { message: 'You are not a member of this room' });
            return;
          }
        }

        socket.join(`room_${roomId}`);
        console.log(`${socket.user.handle} joined room ${room.rows[0].name}`);

        // Notify room that user joined
        socket.to(`room_${roomId}`).emit('user_joined', {
          user: socket.user.handle,
          roomId: roomId
        });
      } catch (err) {
        console.error('Error joining room:', err);
        socket.emit('error', { message: 'Failed to join room' });
      } finally {
        client.release();
      }
    });

    // Leave a chat room
    socket.on('leave_room', (roomId) => {
      socket.leave(`room_${roomId}`);
      console.log(`${socket.user.handle} left room ${roomId}`);

      // Notify room that user left
      socket.to(`room_${roomId}`).emit('user_left', {
        user: socket.user.handle,
        roomId: roomId
      });
    });

    // Send a message
    socket.on('send_message', async (data) => {
      console.log('Received send_message from', socket.user.handle, ':', data);
      const { roomId, message } = data;

      if (!message || message.trim().length === 0) {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }

      if (message.length > 1000) {
        socket.emit('error', { message: 'Message cannot exceed 1000 characters' });
        return;
      }

      const client = await getClient();
      try {
        // Verify room exists
        const room = await client.query('SELECT id FROM chat_rooms WHERE id = $1 AND is_active = true', [roomId]);
        if (room.rowCount === 0) {
          socket.emit('error', { message: 'Chat room not found' });
          return;
        }

        // Insert message
        const result = await client.query(
          'INSERT INTO chat_messages (room_id, user_id, message) VALUES ($1, $2, $3)',
          [roomId, socket.user.id, message.trim()]
        );

        // Get the inserted message
        const newMessage = await client.query(
          `SELECT
            m.id, m.message, m.image_path, m.created_at,
            u.id as user_id, u.handle
          FROM chat_messages m
          JOIN users u ON m.user_id = u.id
          WHERE m.id = $1`,
          [result.insertId]
        );

        const messageData = newMessage.rows[0];

        // Run keyword filter (async, fire-and-forget)
        checkAndFilterContent('chat_message', messageData.id, [message], socket.user.id).catch(() => {});

        // Broadcast message to everyone in the room (including sender)
        io.to(`room_${roomId}`).emit('new_message', {
          roomId: roomId,
          message: messageData
        });
      } catch (err) {
        console.error('Error sending message:', err);
        socket.emit('error', { message: 'Failed to send message' });
      } finally {
        client.release();
      }
    });

    // Typing indicator
    socket.on('typing_start', (roomId) => {
      socket.to(`room_${roomId}`).emit('user_typing', {
        user: socket.user.handle,
        roomId: roomId
      });
    });

    socket.on('typing_stop', (roomId) => {
      socket.to(`room_${roomId}`).emit('user_stopped_typing', {
        user: socket.user.handle,
        roomId: roomId
      });
    });

    // Join a blog post room for real-time comments
    socket.on('join_post', (postId) => {
      socket.join(`post_${postId}`);
      console.log(`${socket.user.handle} joined post ${postId} comments`);
    });

    // Leave a blog post room
    socket.on('leave_post', (postId) => {
      socket.leave(`post_${postId}`);
      console.log(`${socket.user.handle} left post ${postId} comments`);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.handle}`);
      userSockets.delete(socket.user.id);
    });
  });
};

// Emit to a specific user by their user ID (uses rooms for multi-tab and Redis support)
const emitToUser = (userId, event, data) => {
  if (ioInstance) {
    ioInstance.to(`user_${userId}`).emit(event, data);
  }
};

module.exports = { initializeSocket, userSockets, getIO, emitToUser };
