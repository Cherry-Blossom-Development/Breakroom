const { getClient } = require('../utilities/db');

/**
 * Whether a user has a permission, directly or through one of their groups.
 * @param {object} client - A database client from getClient()
 * @param {string} permissionName - Name of the permission
 * @param {number} userId
 */
async function hasPermission(client, permissionName, userId) {
  const result = await client.query(`
    SELECT 1 FROM permissions p
    WHERE p.name = $1 AND p.is_active = true AND (
      EXISTS (
        SELECT 1 FROM user_permissions up
        WHERE up.permission_id = p.id AND up.user_id = $2
      )
      OR EXISTS (
        SELECT 1 FROM group_permissions gp
        JOIN user_groups ug ON ug.group_id = gp.group_id
        WHERE gp.permission_id = p.id AND ug.user_id = $3
      )
    )
  `, [permissionName, userId, userId]);
  return result.rowCount > 0;
}

/**
 * Middleware factory that checks if user has a specific permission
 * @param {string} permissionName - Name of the required permission
 */
const checkPermission = (permissionName) => {
  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const client = await getClient();
    try {
      if (!(await hasPermission(client, permissionName, req.user.id))) {
        return res.status(403).json({ message: 'Permission denied' });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ message: 'Permission check failed' });
    } finally {
      client.release();
    }
  };
};

module.exports = { checkPermission, hasPermission };
