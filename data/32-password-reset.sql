-- Add password reset columns to users table
ALTER TABLE users
  ADD COLUMN password_reset_token VARCHAR(64) NULL,
  ADD COLUMN password_reset_expires_at TIMESTAMP NULL;

-- Add password reset email template
INSERT INTO system_emails (email_key, from_address, subject, html_content, is_active)
VALUES (
  'password_reset',
  'noreply@prosaurus.com',
  'Reset Your Breakroom Password',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo img { width: 64px; height: 64px; border-radius: 50%; }
    h2 { color: #333; text-align: center; }
    p { color: #555; line-height: 1.6; }
    .btn { display: block; width: fit-content; margin: 24px auto; padding: 12px 28px; background: #007bff; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 1em; }
    .footer { margin-top: 32px; font-size: 0.8em; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="https://www.prosaurus.com/logo-192x192-no-text.png" alt="Breakroom" />
    </div>
    <h2>Reset Your Password</h2>
    <p>We received a request to reset your Breakroom password. Click the button below to choose a new password. This link expires in 1 hour.</p>
    <a class="btn" href="https://www.prosaurus.com/reset-password?token={{reset_token}}">Reset Password</a>
    <p>If you did not request a password reset, you can safely ignore this email.</p>
    <div class="footer">Breakroom by Prosaurus &mdash; <a href="https://www.prosaurus.com">www.prosaurus.com</a></div>
  </div>
</body>
</html>',
  true
);
