const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// Create SES client - uses AWS credentials from environment
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const sendMail = async (to, from, subject, htmlContent, replyTo = null) => {
  const params = {
    Destination: {
      ToAddresses: [to]
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: htmlContent
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: subject
      }
    },
    Source: from,
    ...(replyTo && { ReplyToAddresses: [replyTo] })
  };

  console.log('Attempting to send email via AWS SES to:', to);

  try {
    const command = new SendEmailCommand(params);
    const response = await sesClient.send(command);
    console.log('Email sent successfully to:', to, 'MessageId:', response.MessageId);
    return { status: 200, message: 'Email sent successfully!' };
  } catch (error) {
    console.error('AWS SES error:', error.message);
    console.error('AWS SES error code:', error.Code || error.name);
    return { status: 500, message: 'Error sending email: ' + error.message };
  }
};

module.exports = {
  sendMail
};
