/**
 * Idempotent one-time setup: creates the "Prosaurus Pro" $3.99/mo product + billing
 * plan in PayPal's Catalog Products / Billing Plans APIs, if they don't already exist.
 * Safe to re-run. Mirrors scripts/square-setup-pro-plan.js's shape, but PayPal splits
 * this into two separate API calls (product, then plan against that product) rather
 * than Square's single Catalog batch-upsert -- neither has an SDK wrapper for these
 * two APIs specifically (see utilities/paypal.js), so this goes through raw REST.
 *
 * Usage: node scripts/paypal-setup-pro-plan.js
 *
 * Prints the plan ID -- copy it into PAYPAL_PRO_PLAN_ID in .env.local. That ID is what
 * backend/utilities/payments/paypal.js references when confirming subscriptions.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const { paypalRequest } = require('../utilities/paypal');

const PRODUCT_NAME = 'Prosaurus Pro';
const PLAN_NAME = 'Prosaurus Pro - Monthly';
const PRICE_DOLLARS = '3.99';

async function findExistingProduct() {
  const res = await paypalRequest('GET', '/v1/catalogs/products?page_size=20&total_required=false');
  return (res.products || []).find(p => p.name === PRODUCT_NAME) || null;
}

async function createProduct() {
  return paypalRequest('POST', '/v1/catalogs/products', {
    name: PRODUCT_NAME,
    description: 'Prosaurus Pro subscription -- waives the marketplace seller commission and unlocks paywalled features.',
    type: 'SERVICE',
    category: 'SOFTWARE'
  });
}

async function findExistingPlan(productId) {
  const res = await paypalRequest('GET', `/v1/billing/plans?product_id=${productId}&page_size=20&total_required=false`);
  return (res.plans || []).find(p => p.name === PLAN_NAME) || null;
}

async function createPlan(productId) {
  return paypalRequest('POST', '/v1/billing/plans', {
    product_id: productId,
    name: PLAN_NAME,
    description: '$3.99/month Prosaurus Pro subscription',
    billing_cycles: [
      {
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // 0 = infinite (until cancelled)
        pricing_scheme: {
          fixed_price: { value: PRICE_DOLLARS, currency_code: 'USD' }
        }
      }
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 3
    }
  });
}

async function main() {
  console.log('=== PayPal Pro Plan Setup ===');

  let product = await findExistingProduct();
  if (product) {
    console.log(`Product "${PRODUCT_NAME}" already exists (${product.id}).`);
  } else {
    console.log(`Creating product "${PRODUCT_NAME}"...`);
    product = await createProduct();
    console.log(`Created product ${product.id}.`);
  }

  let plan = await findExistingPlan(product.id);
  if (plan) {
    console.log(`Plan "${PLAN_NAME}" already exists.`);
    console.log(`Plan ID: ${plan.id}`);
    return;
  }

  console.log(`Creating plan "${PLAN_NAME}" ($${PRICE_DOLLARS}/mo)...`);
  plan = await createPlan(product.id);
  console.log('Created successfully.');
  console.log(`Plan ID: ${plan.id}`);
  console.log('\nCopy this into PAYPAL_PRO_PLAN_ID in .env.local');
}

main().catch(err => {
  console.error('Script failed:', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
