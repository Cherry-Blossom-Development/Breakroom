#!/usr/bin/env node
// Host-side custom domain provisioning agent.
//
// Runs OUTSIDE Docker, directly on the EC2 host, as a systemd timer + oneshot
// service (see ../../infra/systemd/). The Docker backend never touches nginx
// or certbot directly — it only writes rows to `custom_domains`; this script
// is the only thing with real host privileges that acts on them.
//
// Deliberately has its own minimal dependency (`mysql2` only, see
// package.json alongside this file) so it can be installed independently of
// the Docker backend's node_modules.
//
// Config is read entirely from the environment (see infra/systemd's
// EnvironmentFile) — no dotenv dependency needed on the host.

'use strict';

const mysql = require('mysql2/promise');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const DB_HOST = requireEnv('DB_HOST');
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = requireEnv('DB_USER');
const DB_PASS = requireEnv('DB_PASS');
const DB_NAME = requireEnv('DB_NAME');

const TARGET_IP = requireEnv('CUSTOM_DOMAIN_TARGET_IP');
const NGINX_CONF_DIR = process.env.NGINX_CONF_DIR || '/etc/nginx/conf.d';
const TEMPLATE_DIR = process.env.CUSTOM_DOMAIN_TEMPLATE_DIR || path.join(__dirname, '..', '..', 'infra');
const CERTBOT_EMAIL = requireEnv('CERTBOT_EMAIL');
const CERTBOT_STAGING = process.env.CERTBOT_STAGING === 'true';
const MAX_PENDING_HOURS = Number(process.env.CUSTOM_DOMAIN_MAX_PENDING_HOURS || 48);

const SUDO = process.env.CUSTOM_DOMAIN_AGENT_SUDO !== 'false'; // set to 'false' only for local/manual testing as root

// Domain is validated by the API before it ever reaches this table, but never
// trust that alone — re-validate here too, right before it's used to build a
// filesystem path and shell out to nginx/certbot.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[custom-domain-agent] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function log(...args) {
  console.log(`[custom-domain-agent ${new Date().toISOString()}]`, ...args);
}

function assertValidDomain(domain) {
  if (typeof domain !== 'string' || !DOMAIN_RE.test(domain)) {
    throw new Error(`Refusing to process invalid domain value: ${JSON.stringify(domain)}`);
  }
}

// Run a host command with an argument array — never string-interpolate into a
// shell, to prevent command injection via a malicious/malformed domain value.
async function run(cmd, args) {
  const fullCmd = SUDO ? 'sudo' : cmd;
  const fullArgs = SUDO ? [cmd, ...args] : args;
  log('running:', fullCmd, fullArgs.join(' '));
  try {
    const { stdout, stderr } = await execFileAsync(fullCmd, fullArgs, { timeout: 120000 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

async function writeConfAtomic(domain, contents) {
  const target = path.join(NGINX_CONF_DIR, `${domain}.conf`);

  // Sanity checks independent of nginx's own `-t` validation — catches a
  // broken template substitution before it's ever loaded. Comments are
  // stripped first so explanatory prose (e.g. this very function's own
  // template header warning about default_server) can't trip the check on
  // its wording alone — only actual directives count.
  const codeOnly = contents
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n');

  if (!codeOnly.includes(`server_name`) || !codeOnly.includes(domain)) {
    throw new Error(`Rendered nginx conf for ${domain} does not contain the expected server_name — aborting.`);
  }
  if (codeOnly.includes('default_server')) {
    throw new Error(`Rendered nginx conf for ${domain} unexpectedly contains default_server — aborting.`);
  }

  // /etc/nginx/conf.d is root-owned, so the unprivileged agent user can't
  // write there directly — write locally first (unprivileged), copy into
  // conf.d as a hidden temp file via sudo, then `mv` into place. The `mv` is
  // a same-directory rename (atomic on POSIX), so a crash mid-write can
  // never leave a half-written file for `nginx -t` or a concurrent reload
  // to trip on — only the final, complete file ever lands at `target`.
  const tmp = path.join(os.tmpdir(), `${domain}.conf.${process.pid}.tmp`);
  await fs.writeFile(tmp, contents, 'utf8');
  const targetTmp = path.join(NGINX_CONF_DIR, `.${domain}.conf.tmp`);
  const copyResult = await run('/usr/bin/cp', [tmp, targetTmp]);
  if (!copyResult.ok) throw new Error(`Failed to stage nginx conf for ${domain}: ${copyResult.stderr}`);
  const moveResult = await run('/usr/bin/mv', [targetTmp, target]);
  if (!moveResult.ok) throw new Error(`Failed to activate nginx conf for ${domain}: ${moveResult.stderr}`);
  await fs.unlink(tmp).catch(() => {});
  return target;
}

async function removeConf(domain) {
  const target = path.join(NGINX_CONF_DIR, `${domain}.conf`);
  await run('/usr/bin/rm', ['-f', target]);
}

async function reloadNginx() {
  const test = await run('/usr/sbin/nginx', ['-t']);
  if (!test.ok) throw new Error(`nginx -t failed: ${test.stderr}`);
  const reload = await run('/usr/bin/systemctl', ['reload', 'nginx']);
  if (!reload.ok) throw new Error(`systemctl reload nginx failed: ${reload.stderr}`);
}

async function renderTemplate(templateName, domain, serverNames) {
  const templatePath = path.join(TEMPLATE_DIR, templateName);
  const raw = await fs.readFile(templatePath, 'utf8');
  return raw
    .split('{{SERVER_NAMES}}').join(serverNames)
    .split('{{DOMAIN}}').join(domain);
}

async function dnsMatches(domain) {
  const checks = await Promise.allSettled([
    dns.resolve4(domain),
    dns.resolve4(`www.${domain}`),
  ]);
  const [apex, www] = checks;
  const apexOk = apex.status === 'fulfilled' && apex.value.includes(TARGET_IP);
  const wwwOk = www.status === 'fulfilled' && www.value.includes(TARGET_IP);
  return { apexOk, wwwOk };
}

async function issueCertificate(domain, includeWww) {
  const args = [
    'certonly', '--nginx', '--non-interactive', '--agree-tos',
    '-m', CERTBOT_EMAIL,
    '-d', domain,
  ];
  if (includeWww) args.push('-d', `www.${domain}`);
  if (CERTBOT_STAGING) args.push('--staging');
  return run('/usr/bin/certbot', args);
}

async function provisionDomain(client, row) {
  const { id, domain } = row;
  assertValidDomain(domain);
  log(`provisioning ${domain} (id=${id})`);

  try {
    // Stage 1: HTTP-only conf so certbot's HTTP-01 challenge has somewhere to answer.
    const httpConf = await renderTemplate('nginx-custom-domain-http.template.conf', domain, `${domain} www.${domain}`);
    await writeConfAtomic(domain, httpConf);
    await reloadNginx();

    // Try apex+www together first; fall back to apex-only if www doesn't validate.
    let certResult = await issueCertificate(domain, true);
    let includeWww = true;
    if (!certResult.ok) {
      log(`combined cert issuance failed for ${domain}, retrying apex-only:`, certResult.stderr.slice(0, 500));
      certResult = await issueCertificate(domain, false);
      includeWww = false;
    }
    if (!certResult.ok) {
      throw new Error(`certbot failed: ${certResult.stderr.slice(0, 480)}`);
    }

    // Stage 2: swap in the SSL conf now that a certificate exists.
    const serverNames = includeWww ? `${domain} www.${domain}` : domain;
    const sslConf = await renderTemplate('nginx-custom-domain-ssl.template.conf', domain, serverNames);
    await writeConfAtomic(domain, sslConf);
    await reloadNginx();

    await client.query(
      `UPDATE custom_domains SET status = 'active', activated_at = NOW(), error_message = NULL WHERE id = ?`,
      [id]
    );
    log(`${domain} is now active${includeWww ? '' : ' (apex only — www did not validate)'}`);
  } catch (err) {
    log(`provisioning failed for ${domain}:`, err.message);
    await client.query(
      `UPDATE custom_domains SET status = 'failed', error_message = ? WHERE id = ?`,
      [String(err.message).slice(0, 500), id]
    );
  }
}

async function deprovisionDomain(client, row) {
  const { id, domain } = row;
  assertValidDomain(domain);
  log(`deprovisioning ${domain} (id=${id})`);
  try {
    await removeConf(domain);
    await reloadNginx();
  } catch (err) {
    // Log and continue — a removal row should not get stuck forever just
    // because nginx reload hit a transient error; the conf file removal
    // itself (best-effort `rm -f`) already ran.
    log(`non-fatal error deprovisioning ${domain}:`, err.message);
  }
  await client.query('DELETE FROM custom_domains WHERE id = ?', [id]);
}

async function handlePendingDns(client, row) {
  const { id, domain, created_at } = row;
  assertValidDomain(domain);

  const { apexOk, wwwOk } = await dnsMatches(domain);
  if (apexOk) {
    // Claim atomically — guards against a second concurrent run (shouldn't
    // happen under systemd's oneshot overlap protection, but cheap to keep).
    const [claim] = await client.query(
      `UPDATE custom_domains SET status = 'provisioning', verification_attempts = verification_attempts + 1, last_checked_at = NOW() WHERE id = ? AND status = 'pending_dns'`,
      [id]
    );
    if (claim.affectedRows === 0) return; // someone else already claimed it
    log(`DNS matched for ${domain} (www ${wwwOk ? 'also matched' : 'not yet'}) — provisioning`);
    await provisionDomain(client, { id, domain });
    return;
  }

  const ageHours = (Date.now() - new Date(created_at).getTime()) / 3600000;
  if (ageHours > MAX_PENDING_HOURS) {
    await client.query(
      `UPDATE custom_domains SET status = 'failed', error_message = ? WHERE id = ?`,
      [`DNS did not point to ${TARGET_IP} within ${MAX_PENDING_HOURS} hours.`, id]
    );
    log(`${domain} timed out waiting for DNS (${MAX_PENDING_HOURS}h)`);
    return;
  }

  await client.query(
    `UPDATE custom_domains SET verification_attempts = verification_attempts + 1, last_checked_at = NOW() WHERE id = ?`,
    [id]
  );
}

async function main() {
  const conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, database: DB_NAME });

  try {
    const [pending] = await conn.query(`SELECT id, domain, created_at FROM custom_domains WHERE status = 'pending_dns'`);
    for (const row of pending) {
      await handlePendingDns(conn, row);
    }

    // Rows still in `provisioning` mean a previous run crashed mid-provision — resume them.
    const [stuck] = await conn.query(`SELECT id, domain FROM custom_domains WHERE status = 'provisioning'`);
    for (const row of stuck) {
      await provisionDomain(conn, row);
    }

    const [removing] = await conn.query(`SELECT id, domain FROM custom_domains WHERE status = 'removing'`);
    for (const row of removing) {
      await deprovisionDomain(conn, row);
    }

    log(`cycle complete: ${pending.length} pending checked, ${stuck.length} resumed, ${removing.length} removed`);
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('[custom-domain-agent] fatal:', err);
  process.exit(1);
});
