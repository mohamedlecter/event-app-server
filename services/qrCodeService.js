const QRCode = require('qrcode');
const crypto = require('crypto');

// Generate QR code data for a ticket
const generateTicketQRCode = async (ticket) => {
  try {
    // Create a unique payload for the QR code
    const payload = {
      ticketId: ticket._id.toString(),
      reference: ticket.reference,
      eventId: ticket.event.toString(),
      timestamp: Date.now(),
      // Add a hash to prevent tampering
      hash: crypto
        .createHash('sha256')
        .update(`${ticket._id}${ticket.reference}${process.env.QR_SECRET_KEY}`)
        .digest('hex')
    };

    // Convert payload to string
    const qrData = JSON.stringify(payload);

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300
    });

    return {
      data: qrCodeDataUrl,
      generatedAt: new Date()
    };
  } catch (error) {
    console.error('QR Code generation failed:', error);
    throw new Error('Failed to generate QR code');
  }
};

// Verify QR code data
const verifyQRCode = (qrData) => {
  try {
    const payload = JSON.parse(qrData);
    
    // Verify the hash
    const expectedHash = crypto
      .createHash('sha256')
      .update(`${payload.ticketId}${payload.reference}${process.env.QR_SECRET_KEY}`)
      .digest('hex');

    if (payload.hash !== expectedHash) {
      throw new Error('Invalid QR code');
    }

    // Check if QR code is expired (24 hours)
    const qrAge = Date.now() - payload.timestamp;
    if (qrAge > 24 * 60 * 60 * 1000) {
      throw new Error('QR code expired');
    }

    return payload;
  } catch (error) {
    throw new Error('Invalid QR code data');
  }
};

module.exports = {
  generateTicketQRCode,
  verifyQRCode
}; 