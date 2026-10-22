-- Migration 093: Greywire emails come from greywirestudio.com
-- greywirestudio.com is now verified in Amazon SES (DKIM, us-west-2), so the
-- Greywire templates from 091 switch from the prosaurus.com sender. Mail built
-- in code uses SITES.greywire.emailFrom in backend/utilities/site.js.

UPDATE system_emails
SET from_address = 'Greywire Studio <noreply@greywirestudio.com>'
WHERE site = 'greywire'
  AND from_address = 'Greywire Studio <noreply@prosaurus.com>';
