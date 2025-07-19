const Ticket = require("../Models/Ticket");
const User = require("../Models/Users");
const twilio = require('twilio');
const { createLogger, format, transports } = require("winston");

// Configure logger
const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: "logs/notification-error.log", level: "error" }),
    new transports.File({ filename: "logs/notification.log" }),
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    })
  ]
});

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Validate Twilio configuration
const validateTwilioConfig = () => {
  const missing = [];
  
  if (!process.env.TWILIO_ACCOUNT_SID) {
    missing.push('TWILIO_ACCOUNT_SID');
  }
  
  if (!process.env.TWILIO_AUTH_TOKEN) {
    missing.push('TWILIO_AUTH_TOKEN');
  }
  
  if (!TWILIO_PHONE_NUMBER) {
    missing.push('TWILIO_PHONE_NUMBER');
  }
  
  if (missing.length > 0) {
    logger.error('Missing Twilio configuration', { missing });
    return false;
  }
  
  return true;
};

// Format phone number for Twilio
const formatPhoneNumber = (phoneNumber) => {
  // Remove all spaces and special characters except + and digits
  let formatted = phoneNumber.replace(/[^\d+]/g, '');
  
  // If it already starts with +, return as is
  if (formatted.startsWith('+')) {
    return formatted;
  }
  
  // If it starts with 0, check for different country codes
  if (formatted.startsWith('0')) {
    // For Gambia: 0 + 7 digits = +220 + 7 digits
    if (formatted.length === 8) {
      return '+220' + formatted.substring(1);
    }
    // For Qatar: 0 + 8 digits = +974 + 8 digits
    if (formatted.length === 9) {
      return '+974' + formatted.substring(1);
    }
  }
  
  // If it's 7 digits (Gambia format), add +220
  if (formatted.length === 7) {
    return '+220' + formatted;
  }
  
  // If it's 8 digits (Qatar format), add +974
  if (formatted.length === 8) {
    return '+974' + formatted;
  }
  
  // If it's 10 digits (US/Canada format), add +1
  if (formatted.length === 10) {
    return '+1' + formatted;
  }
  
  // For any other format, just add + prefix
  return '+' + formatted;
};

const sendEmailNotification = async (email, notificationData) => {
  // TODO: Implement email notification logic
  // This could use nodemailer or any other email service
  logger.info('Sending email notification to:', { email, notificationData });
};

const sendSMSNotification = async (mobileNumber, message) => {
  try {
    // Validate Twilio configuration first
    if (!validateTwilioConfig()) {
      throw new Error('Twilio configuration is incomplete. Please check your environment variables.');
    }

    const formattedNumber = formatPhoneNumber(mobileNumber);
    
    logger.info('Sending SMS notification', { 
      to: formattedNumber, 
      from: 'GESCO',
      message: message.substring(0, 50) + '...' 
    });

    const result = await twilioClient.messages.create({
      body: message,
      from: 'GESCO',
      to: formattedNumber
    });

    logger.info('SMS sent successfully', { 
      messageId: result.sid, 
      to: formattedNumber,
      status: result.status
    });

    return {
      success: true,
      messageId: result.sid,
      status: result.status
    };
  } catch (error) {
    logger.error('SMS sending failed', {
      error: error.message,
      mobileNumber,
      twilioError: error.code,
      twilioPhoneNumber: TWILIO_PHONE_NUMBER || 'NOT_SET'
    });
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
};

// Send ticket purchase confirmation SMS
const sendTicketPurchaseSMS = async (userId, ticketData) => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.mobileNumber) {
      throw new Error('User not found or no mobile number available');
    }

    const message = `🎫 Ticket Purchase Confirmed!\n\n` +
      `Event: ${ticketData.eventTitle}\n` +
      `Date: ${new Date(ticketData.eventDate).toLocaleDateString()}\n` +
      `Ticket Type: ${ticketData.ticketType.toUpperCase()}\n` +
      `Quantity: ${ticketData.quantity}\n` +
      `Total: $${ticketData.amount}\n\n` +
      `Enjoy the event!`;

    return await sendSMSNotification(user.mobileNumber, message);
  } catch (error) {
    logger.error('Failed to send ticket purchase SMS', {
      error: error.message,
      userId,
      ticketData
    });
    throw error;
  }
};

// Send ticket transfer notification SMS
const sendTicketTransferSMS = async (ticketId, recipientInfo) => {
  try {
    const { recipientType, recipientValue, recipientName } = recipientInfo;
    const ticket = await Ticket.findById(ticketId).populate('event');

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    const notificationData = {
      ticketId: ticket._id,
      eventName: ticket.event.title,
      eventDate: ticket.event.date,
      ticketType: ticket.ticketType,
      recipientType,
      recipientValue,
      recipientName
    };

    if (recipientType === 'email') {
      await sendEmailNotification(recipientValue, notificationData);
    } else if (recipientType === 'mobile') {
      const message = `🎫 Ticket Transfer Notification!\n\n` +
        `Hello ${recipientName || 'there'}!\n\n` +
        `You have received a ticket transfer:\n` +
        `Event: ${ticket.event.title}\n` +
        `Date: ${new Date(ticket.event.date).toLocaleDateString()}\n` +
        `Ticket Type: ${ticket.ticketType.toUpperCase()}\n\n` +
        `Enjoy the event!`;

      return await sendSMSNotification(recipientValue, message);
    }

    return notificationData;
  } catch (error) {
    logger.error('Failed to send transfer notification', {
      error: error.message,
      ticketId,
      recipientInfo
    });
    throw error;
  }
};

// Send transfer confirmation to original ticket owner
const sendTransferConfirmationSMS = async (userId, transferData) => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.mobileNumber) {
      throw new Error('User not found or no mobile number available');
    }

    const message = `✅ Ticket Transfer Completed!\n\n` +
      `Your ticket has been successfully transferred to:\n` +
      `Name: ${transferData.recipientName}\n` +
      `Contact: ${transferData.recipientValue}\n\n` +
      `Event: ${transferData.eventName}\n` +
      `Date: ${new Date(transferData.eventDate).toLocaleDateString()}\n\n` +
      `The recipient has been notified.`;

    return await sendSMSNotification(user.mobileNumber, message);
  } catch (error) {
    logger.error('Failed to send transfer confirmation SMS', {
      error: error.message,
      userId,
      transferData
    });
    throw error;
  }
};

const sendTransferNotification = async (ticketId, recipientInfo) => {
  const { recipientType, recipientValue } = recipientInfo;
  const ticket = await Ticket.findById(ticketId).populate('event');

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const notificationData = {
    ticketId: ticket._id,
    eventName: ticket.event.title,
    eventDate: ticket.event.date,
    ticketType: ticket.ticketType,
    recipientType,
    recipientValue
  };

  if (recipientType === 'email') {
    await sendEmailNotification(recipientValue, notificationData);
  } else if (recipientType === 'mobile') {
    await sendSMSNotification(recipientValue, notificationData);
  }

  return notificationData;
};

module.exports = {
  sendEmailNotification,
  sendSMSNotification,
  sendTransferNotification,
  sendTicketPurchaseSMS,
  sendTicketTransferSMS,
  sendTransferConfirmationSMS,
}; 