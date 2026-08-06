-- Migration 048: Alternate email address
-- Lets a user (or an admin, on their behalf) add a second email address that
-- eligible notification emails can also be delivered to. A user-entered address
-- must be confirmed via a link before it's used (own token/expiry pair, independent
-- of the existing primary-email verification columns in data/1-user-auth.sql); an
-- admin-entered address is trusted immediately and skips confirmation.

ALTER TABLE users
  ADD COLUMN alternate_email VARCHAR(255) NULL,
  ADD COLUMN alternate_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN alternate_email_verification_token VARCHAR(64) NULL,
  ADD COLUMN alternate_email_verification_expires_at TIMESTAMP NULL,
  ADD COLUMN send_notices_to_alternate_email BOOLEAN NOT NULL DEFAULT FALSE;

-- Use {{alternate_verification_token}} as the placeholder, mirroring signup_verification's
-- {{verification_token}} convention (see data/2-system-emails.sql).
INSERT INTO system_emails (email_key, from_address, subject, html_content, description) VALUES
  ('alternate_email_verification',
   'admin@prosaurus.com',
   'Confirm your alternate email for Prosaurus',
   '<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">Prosaurus</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Confirm your alternate email</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="color: #333333; margin: 0 0 20px; font-size: 22px;">One quick step</h2>

              <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
                Someone added this address as an alternate email on a Prosaurus account.
                Confirm it below to start receiving account notices here as well.
              </p>

              <!-- Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 10px 0 30px;">
                    <a href="https://prosaurus.com/verify-alternate-email?token={{alternate_verification_token}}"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                      Confirm Alternate Email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #888888; font-size: 13px; line-height: 1.5; margin: 0 0 20px;">
                If the button does not work, copy and paste this link into your browser:<br>
                <a href="https://prosaurus.com/verify-alternate-email?token={{alternate_verification_token}}" style="color: #667eea; word-break: break-all;">
                  https://prosaurus.com/verify-alternate-email?token={{alternate_verification_token}}
                </a>
              </p>

              <p style="color: #888888; font-size: 13px; line-height: 1.5; margin: 0;">
                If you did not expect this email, you can safely ignore it &mdash; this
                address will not receive anything unless the link above is clicked.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 25px 40px; text-align: center; border-top: 1px solid #eee;">
              <p style="color: #888888; font-size: 13px; margin: 0;">
                This link will expire in 1 hour for your security.
              </p>
              <p style="color: #aaaaaa; font-size: 12px; margin: 15px 0 0;">
                &copy; 2026 Prosaurus. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
   'Sent when a user adds or changes their alternate notification email address; the link confirms ownership before any notices are delivered there.');
