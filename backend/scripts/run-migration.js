// Script to run a SQL migration file against the database
// Usage: node run-migration.js <migration-file.sql>

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function runMigration(migrationFile) {
  const filePath = path.resolve(migrationFile);

  if (!fs.existsSync(filePath)) {
    console.error(`Migration file not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Running migration: ${filePath}`);
  console.log(`Connecting to: ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  const sql = fs.readFileSync(filePath, 'utf8');

  // Create a connection with multipleStatements enabled
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    await connection.query(sql);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: node run-migration.js <migration-file.sql>');
  process.exit(1);
}

runMigration(migrationFile);
