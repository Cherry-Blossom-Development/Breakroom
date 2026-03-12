#!/usr/bin/env node
/**
 * Seed test users for the breakroom_test database.
 * Run from the backend directory with:
 *   node ../data/seed-test-users.js
 *
 * Or directly:
 *   DOTENV_CONFIG_PATH=.env.test node data/seed-test-users.js
 */

require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env.test' });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const testUsers = [
    {
        handle: 'testadmin',
        email: 'testadmin@test.local',
        password: 'TestPass123',
        firstName: 'Test',
        lastName: 'Admin',
        groupName: 'Administrator',
    },
    {
        handle: 'testuser',
        email: 'testuser@test.local',
        password: 'TestPass123',
        firstName: 'Test',
        lastName: 'User',
        groupName: 'Standard',
    },
    {
        handle: 'testunverified',
        email: 'testunverified@test.local',
        password: 'TestPass123',
        firstName: 'Test',
        lastName: 'Unverified',
        groupName: 'Standard',
        emailVerified: false,
        verificationToken: 'test-verification-token-12345',
    },
];

function generateSalt() {
    return crypto.randomBytes(16).toString('hex');
}

async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function main() {
    console.log('Connecting to database:', process.env.DB_HOST, process.env.DB_NAME);

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
    });

    try {
        for (const user of testUsers) {
            // Check if user exists
            const [existing] = await connection.execute(
                'SELECT id FROM users WHERE handle = ?',
                [user.handle]
            );

            if (existing.length > 0) {
                console.log(`User ${user.handle} already exists, skipping...`);
                continue;
            }

            // Generate salt and hash password
            const salt = generateSalt();
            const hash = await hashPassword(user.password, salt);

            // Insert user
            const [result] = await connection.execute(
                `INSERT INTO users (handle, first_name, last_name, email, email_verified, verification_token, hash, salt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.handle,
                    user.firstName,
                    user.lastName,
                    user.email,
                    user.emailVerified !== false, // default true
                    user.verificationToken || null,
                    hash,
                    salt,
                ]
            );

            const userId = result.insertId;
            console.log(`Created user ${user.handle} with ID ${userId}`);

            // Assign to group
            const [groups] = await connection.execute(
                'SELECT id FROM `groups` WHERE name = ?',
                [user.groupName]
            );

            if (groups.length > 0) {
                await connection.execute(
                    'INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)',
                    [userId, groups[0].id]
                );
                console.log(`  Assigned to group: ${user.groupName}`);
            }
        }

        console.log('Test users seeded successfully!');
    } catch (error) {
        console.error('Error seeding test users:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
