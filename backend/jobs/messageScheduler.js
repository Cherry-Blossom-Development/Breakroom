const { getClient } = require('../utilities/db');
const { emitToUser, getIO } = require('../utilities/socket');
const { logCreation } = require('../utilities/creationLogger');
const { checkAndFilterContent } = require('../utilities/contentFilter');
const { sendToUsers } = require('../utilities/fcm');

const TICK_MS = 60 * 1000;

async function sendWarnings() {
  const client = await getClient();
  try {
    const toWarn = await client.query(
      `SELECT scm.id, scm.user_id, scm.message_text, scm.scheduled_at, scm.warning_minutes,
              u.handle, cr.name AS room_name
       FROM scheduled_chat_messages scm
       JOIN users u ON u.id = scm.user_id
       JOIN chat_rooms cr ON cr.id = scm.room_id
       WHERE scm.status = 'pending'
         AND scm.is_editing = 0
         AND DATE_SUB(scm.scheduled_at, INTERVAL scm.warning_minutes MINUTE) <= NOW()`
    );

    for (const msg of toWarn.rows) {
      const updated = await client.query(
        `UPDATE scheduled_chat_messages SET status = 'warning_sent'
         WHERE id = $1 AND status = 'pending'`,
        [msg.id]
      );
      if (updated.affectedRows === 0) continue;

      const minutesRemaining = Math.max(0, Math.round((new Date(msg.scheduled_at) - Date.now()) / 60000));
      const preview = msg.message_text.length > 120
        ? msg.message_text.substring(0, 120) + '…'
        : msg.message_text;

      emitToUser(msg.user_id, 'scheduled_message_warning', {
        id: msg.id,
        roomName: msg.room_name,
        messagePreview: preview,
        scheduledAt: msg.scheduled_at,
        minutesRemaining
      });

      console.log(`[Scheduler] Warned user ${msg.handle} — message ${msg.id} in #${msg.room_name}`);
    }
  } catch (err) {
    console.error('[Scheduler] sendWarnings error:', err);
  } finally {
    client.release();
  }
}

async function deliverDueMessages() {
  const client = await getClient();
  try {
    const toDo = await client.query(
      `SELECT scm.id, scm.user_id, scm.room_id, scm.message_text, scm.indicator_text,
              u.handle, cr.name AS room_name
       FROM scheduled_chat_messages scm
       JOIN users u ON u.id = scm.user_id
       JOIN chat_rooms cr ON cr.id = scm.room_id
       WHERE scm.status IN ('pending', 'warning_sent', 'confirmed')
         AND scm.is_editing = 0
         AND scm.scheduled_at <= NOW()`
    );

    for (const msg of toDo.rows) {
      const claimed = await client.query(
        `UPDATE scheduled_chat_messages SET status = 'sent'
         WHERE id = $1 AND status NOT IN ('sent', 'cancelled')`,
        [msg.id]
      );
      if (claimed.affectedRows === 0) continue;

      const body = msg.indicator_text && msg.indicator_text.trim()
        ? `${msg.message_text}\n${msg.indicator_text}`
        : msg.message_text;

      try {
        const ins = await client.query(
          'INSERT INTO chat_messages (room_id, user_id, message, is_scheduled) VALUES ($1, $2, $3, 1)',
          [msg.room_id, msg.user_id, body]
        );

        const fetched = await client.query(
          `SELECT m.id, m.message, m.image_path, m.video_path, m.created_at, m.is_scheduled,
                  u.id AS user_id, u.handle
           FROM chat_messages m
           JOIN users u ON m.user_id = u.id
           WHERE m.id = $1`,
          [ins.insertId]
        );
        const messageData = fetched.rows[0];

        logCreation('chat_messages', messageData.id, {
          userId: msg.user_id,
          ipAddress: 'scheduler',
          userAgent: 'MessageScheduler'
        }).catch(() => {});

        checkAndFilterContent('chat_message', messageData.id, [body], msg.user_id).catch(() => {});

        const io = getIO();
        if (io) {
          io.to(`room_${msg.room_id}`).emit('new_message', {
            roomId: msg.room_id,
            message: messageData
          });
        }

        const members = await client.query(
          `SELECT user_id FROM users_rooms
           WHERE room_id = $1 AND user_id != $2 AND accepted = TRUE AND notifications_muted = FALSE`,
          [msg.room_id, msg.user_id]
        );
        sendToUsers(members.rows.map(r => r.user_id), {
          type: 'chat_message',
          roomId: String(msg.room_id),
          roomName: msg.room_name,
          senderHandle: msg.handle,
          message: body
        }).catch(() => {});

        console.log(`[Scheduler] Delivered message ${msg.id} to #${msg.room_name}`);
      } catch (sendErr) {
        console.error(`[Scheduler] Failed to deliver message ${msg.id}:`, sendErr);
        await client.query(
          `UPDATE scheduled_chat_messages SET status = 'warning_sent' WHERE id = $1`,
          [msg.id]
        );
      }
    }
  } catch (err) {
    console.error('[Scheduler] deliverDueMessages error:', err);
  } finally {
    client.release();
  }
}

async function cancelExpiredEdits() {
  const client = await getClient();
  try {
    const expired = await client.query(
      `SELECT scm.id, scm.user_id, scm.message_text
       FROM scheduled_chat_messages scm
       WHERE scm.is_editing = 1
         AND scm.status NOT IN ('sent', 'cancelled')
         AND scm.scheduled_at <= NOW()`
    );

    for (const msg of expired.rows) {
      const claimed = await client.query(
        `UPDATE scheduled_chat_messages SET status = 'cancelled'
         WHERE id = $1 AND is_editing = 1 AND status NOT IN ('sent', 'cancelled')`,
        [msg.id]
      );
      if (claimed.affectedRows === 0) continue;

      const preview = msg.message_text.length > 120
        ? msg.message_text.substring(0, 120) + '…'
        : msg.message_text;

      emitToUser(msg.user_id, 'scheduled_message_missed', {
        id: msg.id,
        messagePreview: preview
      });

      console.log(`[Scheduler] Cancelled message ${msg.id} — expired while editing`);
    }
  } catch (err) {
    console.error('[Scheduler] cancelExpiredEdits error:', err);
  } finally {
    client.release();
  }
}

async function tick() {
  await sendWarnings();
  await deliverDueMessages();
  await cancelExpiredEdits();
}

function startScheduler() {
  console.log('[Scheduler] Started (60s interval)');
  tick().catch(err => console.error('[Scheduler] Initial tick error:', err));
  setInterval(() => {
    tick().catch(err => console.error('[Scheduler] Tick error:', err));
  }, TICK_MS);
}

module.exports = { startScheduler };
