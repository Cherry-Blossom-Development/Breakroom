const express = require('express')
const router = express.Router()
const { getClient } = require('../utilities/db')

/**
 * GET /api/group/all
 * Returns all groups
 */
router.get('/all', async (req, res) => {
  const client = await getClient()
  console.log('Fetching all groups...')
  try {
    const result = await client.query(
      `SELECT id, name, description, is_active, created_at, updated_at
       FROM groups
       ORDER BY id`
    )
    res.status(200).json({ groups: result.rows })
  } catch (err) {
    console.error('Error fetching groups:', err)
    res.status(500).json({ message: 'Failed to fetch groups' })
  } finally {
    client.release()
  }
})

/**
 * POST /api/group
 * Create a new group
 */
router.post('/', async (req, res) => {
  const { name, description, is_active } = req.body

  if (!name || !description) {
    return res.status(400).json({ message: 'Name and description are required.' })
  }

  const client = await getClient()
  try {
    const now = new Date()
    const insertResult = await client.query(
      'INSERT INTO `groups` (name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [name, description, is_active ?? true, now, now]
    )
    // Fetch the newly created group
    const result = await client.query(
      'SELECT id, name, description, is_active, created_at, updated_at FROM `groups` WHERE id = ?',
      [insertResult.insertId]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Error creating group:', err)
    res.status(500).json({ message: 'Failed to create group' })
  } finally {
    client.release()
  }
})

/**
 * PUT /api/group/:id
 * Update an existing group
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params
  const { group, permissions } = req.body

  if (!group.name || !group.description) {
    return res.status(400).json({ message: 'Name and description are required.' })
  }

  const client = await getClient()
  try {
    const now = new Date()

    // Begin the transactional part of the process
    await client.beginTransaction();

    const updateResult = await client.query(
      'UPDATE `groups` SET name = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?',
      [group.name, group.description, group.is_active ?? true, now, id]
    )

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ message: 'group not found' })
    }

    // Fetch the updated group
    const result = await client.query(
      'SELECT id, name, description, is_active, created_at, updated_at FROM `groups` WHERE id = ?',
      [id]
    )

    //Clear current permissions
    await client.query(
      `DELETE FROM group_permissions WHERE group_id = $1`,
      [id]
    );

    const filteredPermissions = permissions.filter(p => p.has_permission);

    if (filteredPermissions.length > 0) {
      const values = filteredPermissions
        .map((_, i) => `($1, $${i + 2})`)
        .join(',');

      const params = [id, ...filteredPermissions.map(p => p.permission_id)];

      await client.query(
        `INSERT INTO group_permissions (group_id, permission_id) VALUES ${values}`,
        params
      );
    }

    await client.commit();

    res.status(200).json(result.rows[0])
  } catch (err) {
    await client.rollback();
    console.error('Error updating group:', err)
    res.status(500).json({ message: 'Failed to update group' })
  } finally {
    client.release()
  }
})

/**
 * DELETE /api/group/:id
 * Delete a group
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params

  const client = await getClient()
  try {
    const result = await client.query(
      'DELETE FROM `groups` WHERE id = ?',
      [id]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'group not found' })
    }

    res.status(200).json({ message: 'group deleted' })
  } catch (err) {
    console.error('Error deleting group:', err)
    res.status(500).json({ message: 'Failed to delete group' })
  } finally {
    client.release()
  }
})

router.get('/groupMatrix/:id', async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {

    console.log('Fetching group data');
    const groupsResult = await client.query(
      `select 
        g.id, g.name, g.description, g.is_active
      from groups g
      where g.id = $1;`,
      [id]
    );

    if (groupsResult.rows.length === 0) {
      // No group found with that ID
      throw new Error('Group not found');
    }

    const group = groupsResult.rows[0];

    console.log('Fetching all permisisons data');
    const permissionsResult = await client.query(
      `SELECT p.id, p.name, p.description, p.is_active,
        CASE
          WHEN gp.group_id IS NOT NULL THEN true
        ELSE false
        END AS has_permission
      FROM permissions p
      LEFT JOIN group_permissions gp
        ON p.id = gp.permission_id
        AND gp.group_id = $1
      ORDER BY p.id;`,
      [id]
    )

    res.status(200).json({
      message: 'Group matrix retrieved',
      group: group,
      permissions: permissionsResult.rows
    });

  } catch (err) {
    console.error('Error fetching group matrix', err);
    res.status(500).json({ message: 'Failed to retrieve group matrix' });
  } finally {
    client.release();
  }
});

module.exports = router
