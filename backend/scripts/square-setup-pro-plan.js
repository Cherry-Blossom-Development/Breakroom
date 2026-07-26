/**
 * Idempotent one-time setup: creates the "Prosaurus Pro" $3.99/mo subscription plan +
 * monthly variation in Square's Catalog, if it doesn't already exist. Safe to re-run.
 *
 * Usage: node scripts/square-setup-pro-plan.js
 *
 * Prints the plan variation ID -- copy it into SQUARE_PRO_PLAN_VARIATION_ID in .env.local.
 * That ID is what backend/routes/billing.js references when creating subscriptions.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const crypto = require('crypto');
const { getSquare } = require('../utilities/square');

const PLAN_NAME = 'Prosaurus Pro';
const VARIATION_NAME = 'Prosaurus Pro - Monthly';
const PRICE_CENTS = 399;

async function findExistingPlanVariation() {
  const response = await getSquare().catalog.list({ types: 'SUBSCRIPTION_PLAN' });
  for await (const obj of response) {
    if (obj.subscriptionPlanData?.name === PLAN_NAME) {
      const variationRef = obj.subscriptionPlanData.subscriptionPlanVariations?.[0];
      if (variationRef) return variationRef.id;
    }
  }
  return null;
}

async function createPlanVariation() {
  const response = await getSquare().catalog.batchUpsert({
    idempotencyKey: crypto.randomUUID(),
    batches: [{
      objects: [
        {
          type: 'SUBSCRIPTION_PLAN',
          id: '#prosaurus-pro-plan',
          subscriptionPlanData: {
            name: PLAN_NAME,
            allItems: false
          }
        },
        {
          type: 'SUBSCRIPTION_PLAN_VARIATION',
          id: '#prosaurus-pro-plan-monthly',
          subscriptionPlanVariationData: {
            name: VARIATION_NAME,
            subscriptionPlanId: '#prosaurus-pro-plan',
            phases: [{
              cadence: 'MONTHLY',
              pricing: {
                type: 'STATIC',
                priceMoney: { amount: BigInt(PRICE_CENTS), currency: 'USD' }
              }
            }]
          }
        }
      ]
    }]
  });

  // The variation comes back nested under the plan's subscriptionPlanData, not as a
  // separate top-level entry in response.objects.
  const plan = response.objects.find(o => o.type === 'SUBSCRIPTION_PLAN');
  return plan.subscriptionPlanData.subscriptionPlanVariations[0].id;
}

async function main() {
  console.log('=== Square Pro Plan Setup ===');

  const existingId = await findExistingPlanVariation();
  if (existingId) {
    console.log(`Plan "${PLAN_NAME}" already exists.`);
    console.log(`Plan variation ID: ${existingId}`);
    return;
  }

  console.log(`Creating "${PLAN_NAME}" ($${(PRICE_CENTS / 100).toFixed(2)}/mo)...`);
  const variationId = await createPlanVariation();
  console.log('Created successfully.');
  console.log(`Plan variation ID: ${variationId}`);
  console.log('\nCopy this into SQUARE_PRO_PLAN_VARIATION_ID in .env.local');
}

main().catch(err => {
  console.error('Script failed:', err.message);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
