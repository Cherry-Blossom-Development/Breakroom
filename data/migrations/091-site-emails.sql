-- Migration 091: Email templates per site
-- Each system email key can now have a Prosaurus and a Greywire version.
-- backend/utilities/systemEmail.js picks the version for the request's site
-- and falls back to Prosaurus when a site has none. Existing templates stay
-- on Prosaurus.
--
-- Greywire mail is sent from prosaurus.com under the Greywire name until
-- greywirestudio.com is verified in Amazon SES. Then update from_address on
-- the greywire rows (Admin > System Emails) and set GREYWIRE_EMAIL_FROM.

ALTER TABLE system_emails
  ADD COLUMN site ENUM('prosaurus', 'greywire') NOT NULL DEFAULT 'prosaurus' AFTER email_key;

ALTER TABLE system_emails DROP INDEX IF EXISTS email_key;
ALTER TABLE system_emails ADD UNIQUE KEY uq_system_emails_key_site (email_key, site);

INSERT INTO system_emails (email_key, site, from_address, subject, description, html_content) VALUES
('signup_verification', 'greywire', 'Greywire Studio <noreply@prosaurus.com>',
 'Verify your email for the Greywire community',
 'Sent on signup from community.greywirestudio.com. Placeholder: {{verification_token}}',
'<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #e8e6e1; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #e8e6e1; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="background-color: #141619; padding: 32px 40px; border-bottom: 4px solid #d07a3e;">
              <p style="color: #d07a3e; margin: 0; font-size: 13px; letter-spacing: 2px; text-transform: uppercase;">Greywire Studio</p>
              <h1 style="color: #e8e6e1; margin: 8px 0 0; font-size: 26px; font-weight: 600;">Welcome to the community</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 40px;">
              <p style="color: #33383e; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                Thanks for signing up. The Greywire community is where Greywire pedal owners chat,
                share recordings and practice with their bands.
              </p>
              <p style="color: #33383e; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                Please verify your email address to finish setting up your account:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 4px 0 28px;">
                    <a href="https://community.greywirestudio.com/verify?token={{verification_token}}"
                       style="display: inline-block; background-color: #d07a3e; color: #141619; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: 700;">
                      Verify My Email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #33383e; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                Then claim your pedal: enter the serial number your pedal reports, and you are in.
                Membership is free with every Greywire pedal.
              </p>
              <p style="color: #6b7077; font-size: 13px; line-height: 1.5; margin: 0;">
                If the button does not work, copy and paste this link into your browser:<br>
                <a href="https://community.greywirestudio.com/verify?token={{verification_token}}" style="color: #b0612a; word-break: break-all;">https://community.greywirestudio.com/verify?token={{verification_token}}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f4f3f0; padding: 20px 40px; text-align: center; border-top: 1px solid #e0ded8;">
              <p style="color: #6b7077; font-size: 13px; margin: 0;">This link expires in 1 hour for your security.</p>
              <p style="color: #9ba0a6; font-size: 12px; margin: 12px 0 0;">Greywire Studio &mdash; <a href="https://greywirestudio.com" style="color: #9ba0a6;">greywirestudio.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>'),

('password_reset', 'greywire', 'Greywire Studio <noreply@prosaurus.com>',
 'Reset your Greywire community password',
 'Sent from the forgot-password page on community.greywirestudio.com. Placeholder: {{reset_token}}',
'<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #e8e6e1; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #e8e6e1; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="background-color: #141619; padding: 32px 40px; border-bottom: 4px solid #d07a3e;">
              <p style="color: #d07a3e; margin: 0; font-size: 13px; letter-spacing: 2px; text-transform: uppercase;">Greywire Studio</p>
              <h1 style="color: #e8e6e1; margin: 8px 0 0; font-size: 26px; font-weight: 600;">Reset your password</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 40px;">
              <p style="color: #33383e; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                We received a request to reset the password for your Greywire community account.
                Click the button below to choose a new one. This link expires in 1 hour.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 4px 0 28px;">
                    <a href="https://community.greywirestudio.com/reset-password?token={{reset_token}}"
                       style="display: inline-block; background-color: #d07a3e; color: #141619; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: 700;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #33383e; font-size: 15px; line-height: 1.6; margin: 0;">
                If you did not ask to reset your password, you can ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f4f3f0; padding: 20px 40px; text-align: center; border-top: 1px solid #e0ded8;">
              <p style="color: #9ba0a6; font-size: 12px; margin: 0;">Greywire Studio &mdash; <a href="https://greywirestudio.com" style="color: #9ba0a6;">greywirestudio.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>'),

('alternate_email_verification', 'greywire', 'Greywire Studio <noreply@prosaurus.com>',
 'Confirm your alternate email for the Greywire community',
 'Sent when a user adds an alternate email on community.greywirestudio.com. Placeholder: {{alternate_verification_token}}',
'<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #e8e6e1; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #e8e6e1; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="background-color: #141619; padding: 32px 40px; border-bottom: 4px solid #d07a3e;">
              <p style="color: #d07a3e; margin: 0; font-size: 13px; letter-spacing: 2px; text-transform: uppercase;">Greywire Studio</p>
              <h1 style="color: #e8e6e1; margin: 8px 0 0; font-size: 26px; font-weight: 600;">Confirm your alternate email</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 40px;">
              <p style="color: #33383e; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                Someone added this address as an alternate email on a Greywire community account.
                Confirm it below to receive account notices here as well.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 4px 0 28px;">
                    <a href="https://community.greywirestudio.com/verify-alternate-email?token={{alternate_verification_token}}"
                       style="display: inline-block; background-color: #d07a3e; color: #141619; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: 700;">
                      Confirm Alternate Email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #6b7077; font-size: 13px; line-height: 1.5; margin: 0;">
                If you did not expect this email, you can ignore it. This address will not receive
                anything unless the link above is clicked.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f4f3f0; padding: 20px 40px; text-align: center; border-top: 1px solid #e0ded8;">
              <p style="color: #6b7077; font-size: 13px; margin: 0;">This link expires in 1 hour for your security.</p>
              <p style="color: #9ba0a6; font-size: 12px; margin: 12px 0 0;">Greywire Studio &mdash; <a href="https://greywirestudio.com" style="color: #9ba0a6;">greywirestudio.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>');
