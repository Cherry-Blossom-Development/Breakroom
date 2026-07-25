/**
 * CLI script to list Square locations for the account tied to SQUARE_ACCESS_TOKEN
 *
 * Usage: node scripts/square-list-locations.js
 *
 * Prints each location's id/name/status so you can copy the right one into
 * SQUARE_LOCATION_ID in .env.local. Run this from the backend directory.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const { SquareClient, SquareEnvironment } = require('square');

async function listLocations() {
  const environment = process.env.SQUARE_ENVIRONMENT === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

  const client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment,
  });

  console.log(`=== Square Locations (${environment}) ===`);

  const response = await client.locations.list();
  const locations = response.locations || [];

  if (locations.length === 0) {
    console.log('No locations found for this access token.');
    return;
  }

  locations.forEach(loc => {
    console.log(`- id: ${loc.id}`);
    console.log(`  name: ${loc.name}`);
    console.log(`  status: ${loc.status}`);
    console.log('');
  });

  console.log(`Copy the id of the location you want into SQUARE_LOCATION_ID in .env.local`);
}

listLocations()
  .catch(err => {
    console.error('Script failed:', err.message);
    if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
    process.exit(1);
  });
