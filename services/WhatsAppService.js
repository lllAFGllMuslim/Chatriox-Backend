const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');

class WhatsAppService {
  constructor() {
    this.clients = new Map();
    this.qrCodes = new Map();
  }

  // Initialize WhatsApp client for a user account
// Updated initializeClient function
async initializeClient(accountId, userId) {
  try {
    const account = await WhatsAppAccount.findOne({ _id: accountId, user: userId });
    if (!account) throw new Error('Account not found');

    console.log(`Initializing client for account: ${accountId}`);

    // Check if client already exists and clean up if not ready
    if (this.clients.has(accountId)) {
      const existingClient = this.clients.get(accountId);
      console.log(`Existing client found for account: ${accountId}`);
      if (existingClient.info) {
        console.log(`Existing client is ready for account: ${accountId}`);
        return existingClient;
      } else {
        console.log(`Cleaning up non-ready client for account: ${accountId}`);
        try {
          await existingClient.destroy();
        } catch (destroyError) {
          console.warn(`Error destroying existing client: ${destroyError.message}`);
        }
        this.clients.delete(accountId);
        this.qrCodes.delete(accountId);
      }
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: accountId,
        dataPath: this.sessionPath
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      }
    });

    // Store client immediately
    this.clients.set(accountId, client);
    console.log(`Client stored in map for account: ${accountId}`);

    // QR Code generation
    client.on('qr', async (qr) => {
      console.log('QR Code generated for account:', accountId);
      this.qrCodes.set(accountId, qr);
      account.qrCode = qr;
      account.status = 'connecting';
      await account.save();
      if (global.io) {
        global.io.to(`user_${userId}`).emit('qr_code', { 
          accountId, 
          qrCode: qr,
          timestamp: new Date()
        });
      }
    });

    // Authentication success
    client.on('authenticated', async () => {
      console.log('WhatsApp authenticated for account:', accountId);
      account.status = 'authenticated';
      await account.save();
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_authenticated', { accountId });
      }
    });

    // Client ready
    client.on('ready', async () => {
      console.log('WhatsApp client ready for account:', accountId);
      if (!this.clients.has(accountId)) {
        console.warn(`Client missing from map after ready, re-adding: ${accountId}`);
        this.clients.set(accountId, client);
      }
      account.status = 'ready';
      account.lastActivity = new Date();
      const info = client.info;
      if (info && info.wid) {
        account.phoneNumber = info.wid.user;
      }
      await account.save();
      console.log(`Client verified in map for account: ${accountId}, Phone: ${account.phoneNumber}`);
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_ready', { 
          accountId, 
          phoneNumber: account.phoneNumber,
          profileName: info?.pushname || 'Unknown'
        });
      }
    });

    // Disconnection handling
    client.on('disconnected', async (reason) => {
      console.log('WhatsApp disconnected for account:', accountId, 'Reason:', reason);
      account.status = 'disconnected';
      await account.save();
      this.clients.delete(accountId);
      this.qrCodes.delete(accountId);
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_disconnected', { accountId, reason });
      }
    });

    // Message acknowledgment
    client.on('message_ack', async (msg, ack) => {
      await this.handleMessageAck(msg, ack, accountId);
    });

    // Authentication failure
    client.on('auth_failure', async (msg) => {
      console.log('Authentication failure for account:', accountId, msg);
      account.status = 'auth_failed';
      await account.save();
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_auth_failed', { accountId, message: msg });
      }
    });

    console.log(`Starting client initialization for account: ${accountId}`);
    await client.initialize();

    return client;
  } catch (error) {
    console.error('Error initializing WhatsApp client:', error);
    if (this.clients.has(accountId)) {
      const client = this.clients.get(accountId);
      try {
        await client.destroy();
      } catch (destroyError) {
        console.warn(`Error destroying client on error: ${destroyError.message}`);
      }
      this.clients.delete(accountId);
    }
    throw error;
  }
}

// Updated sendMessage function
async sendMessage(accountId, recipient, content, options = {}) {
  try {
    console.log(`Attempting to send message for account: ${accountId}, recipient: ${recipient}`);
    console.log(`Available clients: ${Array.from(this.clients.keys())}`);

    const client = this.clients.get(accountId);
    if (!client) {
      console.error(`Client not found for account: ${accountId}`);
      throw new Error('WhatsApp client not found. Please reconnect your WhatsApp account.');
    }

    console.log(`Client found for account: ${accountId}, checking readiness...`);
    if (!client.info) {
      console.error(`Client not ready for account: ${accountId}`);
      throw new Error('WhatsApp client not ready. Please wait for connection to complete.');
    }

    console.log(`Client is ready for account: ${accountId}, Phone: ${client.info.wid?.user}`);

    // Verify client connection state
    try {
      const state = await client.getState();
      console.log(`Client state for account ${accountId}: ${state}`);
      if (state !== 'CONNECTED') {
        console.error(`Client not connected, state: ${state}`);
        throw new Error(`WhatsApp client not connected. Current state: ${state}. Please reconnect.`);
      }
    } catch (stateError) {
      console.error(`Error checking client state: ${stateError.message}`);
      throw new Error('Unable to verify WhatsApp connection. Please reconnect your account.');
    }

    const account = await WhatsAppAccount.findById(accountId);
    if (!account) {
      throw new Error('WhatsApp account not found in database');
    }

    // Ensure account status is up-to-date
    if (account.status !== 'ready') {
      account.status = 'ready';
      await account.save();
    }

    // Reset daily count if needed
    account.resetDailyCount();

    // Check daily limits
    if (account.dailyMessageCount >= account.dailyLimit) {
      throw new Error('Daily message limit reached');
    }

    // Apply anti-blocking delays
    if (options.humanTyping && content.text) {
      await this.simulateTyping(content.text.length);
    }

    if (options.randomDelay) {
      const delay = Math.random() * (options.maxDelay || 5000) + (options.minDelay || 1000);
      await this.sleep(delay);
    }

    // Format phone number
    let phoneNumber = recipient.replace(/\D/g, '');
    if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
      phoneNumber = '91' + phoneNumber;
    }
    const chatId = `${phoneNumber}@c.us`;
    console.log(`Sending ${content.type} message to: ${chatId}`);

    let message;
    switch (content.type) {
      case 'text':
        if (!content.text || content.text.trim() === '') {
          throw new Error('Text content cannot be empty');
        }
        message = await client.sendMessage(chatId, content.text);
        break;

      case 'image':
        if (content.mediaPath && fs.existsSync(content.mediaPath)) {
          const imageMedia = MessageMedia.fromFilePath(content.mediaPath);
          message = await client.sendMessage(chatId, imageMedia, { caption: content.caption });
        } else if (content.mediaUrl) {
          const imageMedia = await MessageMedia.fromUrl(content.mediaUrl);
          message = await client.sendMessage(chatId, imageMedia, { caption: content.caption });
        } else {
          throw new Error('No valid image source provided');
        }
        break;

      case 'video':
        if (content.mediaPath && fs.existsSync(content.mediaPath)) {
          const videoMedia = MessageMedia.fromFilePath(content.mediaPath);
          message = await client.sendMessage(chatId, videoMedia, { caption: content.caption });
        } else if (content.mediaUrl) {
          const videoMedia = await MessageMedia.fromUrl(content.mediaUrl);
          message = await client.sendMessage(chatId, videoMedia, { caption: content.caption });
        } else {
          throw new Error('No valid video source provided');
        }
        break;

      case 'document':
        if (content.mediaPath && fs.existsSync(content.mediaPath)) {
          const docMedia = MessageMedia.fromFilePath(content.mediaPath);
          message = await client.sendMessage(chatId, docMedia, { 
            sendMediaAsDocument: true,
            caption: content.caption || content.fileName
          });
        } else {
          throw new Error('No valid document source provided');
        }
        break;

      case 'audio':
        if (content.mediaPath && fs.existsSync(content.mediaPath)) {
          const audioMedia = MessageMedia.fromFilePath(content.mediaPath);
          message = await client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
        } else {
          throw new Error('No valid audio source provided');
        }
        break;

      default:
        throw new Error('Unsupported message type');
    }

    console.log(`Message sent successfully, ID: ${message.id._serialized}`);

    // Update account statistics
    account.dailyMessageCount += 1;
    account.lastActivity = new Date();
    await account.save();

    return {
      success: true,
      messageId: message.id._serialized,
      timestamp: new Date(),
      chatId: message.to
    };
  } catch (error) {
    console.error(`Error sending message for account ${accountId}: ${error.message}`, error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

// Updated processCampaign function
async processCampaign(campaignId) {
  try {
    const campaign = await WhatsAppCampaign.findById(campaignId)
      .populate('whatsappAccount')
      .populate('user');

    if (!campaign) throw new Error('Campaign not found');

    const accountId = campaign.whatsappAccount._id.toString();
    const client = this.clients.get(accountId);

    if (!client) {
      throw new Error(`WhatsApp client not found for account ${accountId}. Please reconnect.`);
    }

    if (!client.info) {
      throw new Error(`WhatsApp client not ready for account ${accountId}. Please wait for connection.`);
    }

    // Verify client state
    try {
      const state = await client.getState();
      if (state !== 'CONNECTED') {
        throw new Error(`WhatsApp client not connected. State: ${state}`);
      }
    } catch (stateError) {
      throw new Error(`Unable to verify WhatsApp connection: ${stateError.message}`);
    }

    // Proceed with processing the campaign
    campaign.status = 'running';
    campaign.startedAt = new Date();
    await campaign.save();

    const { antiBlockSettings = {} } = campaign;
    const pendingMessages = campaign.messages.filter(m => m.status === 'pending');
    const batchSize = antiBlockSettings.maxMessagesPerBatch || 50;

    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < pendingMessages.length; i += batchSize) {
      const batch = pendingMessages.slice(i, i + batchSize);
      for (const [index, message] of batch.entries()) {
        try {
          // Apply content variation if enabled
          let content = message.content;
          if (antiBlockSettings.contentVariation) {
            content = await this.applyContentVariation(content);
          }

          const result = await this.sendMessage(
            accountId,
            message.recipient.phone,
            content,
            {
              humanTyping: antiBlockSettings.humanTypingDelay,
              randomDelay: antiBlockSettings.randomDelay,
              minDelay: antiBlockSettings.messageDelay || 1000,
              maxDelay: (antiBlockSettings.messageDelay || 1000) * 2
            }
          );

          // Create message record
          const whatsAppMessage = new WhatsAppMessage({
            user: campaign.user._id,
            campaign: campaign._id,
            whatsappAccount: campaign.whatsappAccount._id,
            recipient: message.recipient,
            content: content,
            status: result.success ? 'sent' : 'failed',
            messageId: result.messageId,
            sentAt: result.success ? new Date() : undefined,
            failureReason: result.success ? undefined : result.error
          });

          await whatsAppMessage.save();

          // Update campaign message status
          if (result.success) {
            message.status = 'sent';
            message.sentAt = new Date();
            message.messageId = result.messageId;
            totalSent++;
          } else {
            message.status = 'failed';
            message.failureReason = result.error;
            totalFailed++;
          }

          // Emit progress update
          if (global.io) {
            global.io.to(`user_${campaign.user._id}`).emit('campaign_progress', {
              campaignId: campaign._id,
              progress: {
                total: campaign.messages.length,
                sent: totalSent,
                failed: totalFailed,
                pending: pendingMessages.length - totalSent - totalFailed
              },
              messageUpdate: {
                recipient: message.recipient.phone,
                status: message.status
              }
            });
          }

          // Add delay between messages
          if (index < batch.length - 1) {
            const delay = antiBlockSettings.messageDelay || 2000;
            const randomDelay = Math.random() * delay;
            await this.sleep(delay + randomDelay);
          }

        } catch (error) {
          console.error(`Error processing message to ${message.recipient.phone}:`, error);
          message.status = 'failed';
          message.failureReason = error.message;
          totalFailed++;
        }
      }

      // Save progress after each batch
      await campaign.save();

      // Batch delay
      if (i + batchSize < pendingMessages.length) {
        const batchDelay = antiBlockSettings.batchDelay || 300000;
        await this.sleep(batchDelay);
      }
    }

    campaign.status = totalFailed === 0 ? 'completed' : 'partial';
    campaign.completedAt = new Date();
    await campaign.save();

    // Emit completion event
    if (global.io) {
      global.io.to(`user_${campaign.user._id}`).emit('campaign_completed', {
        campaignId: campaign._id,
        stats: {
          total: campaign.messages.length,
          sent: totalSent,
          failed: totalFailed
        }
      });
    }

    return {
      success: true,
      stats: {
        total: campaign.messages.length,
        sent: totalSent,
        failed: totalFailed
      }
    };

  } catch (error) {
    console.error('Error processing campaign:', error);
    try {
      await WhatsAppCampaign.findByIdAndUpdate(campaignId, {
        status: 'failed',
        errorMessage: error.message,
        updatedAt: new Date()
      });
    } catch (updateError) {
      console.error('Error updating campaign status:', updateError);
    }
    throw error;
  }
}

  // Anti-blocking helper methods
  async simulateTyping(textLength) {
    const typingTime = Math.min(textLength * 50, 5000); // Max 5 seconds
    await this.sleep(typingTime);
  }

  calculateDelay(settings) {
    const baseDelay = settings.messageDelay || 5000;
    if (settings.randomDelayRange) {
      const { min, max } = settings.randomDelayRange;
      return Math.random() * (max - min) + min;
    }
    return baseDelay + (Math.random() * 2000); // Add random 0-2 seconds
  }

  async applyContentVariation(content) {
    if (content.type !== 'text') return content;
    
    const variations = [
      (text) => text,
      (text) => text + ' 😊',
      (text) => text + '\n\nBest regards!',
      (text) => 'Hi! ' + text,
      (text) => text.replace(/\./g, '...'),
    ];
    
    const randomVariation = variations[Math.floor(Math.random() * variations.length)];
    return {
      ...content,
      text: randomVariation(content.text)
    };
  }

  async handleMessageAck(msg, ack, accountId) {
    try {
      // Update message status based on acknowledgment
      const campaign = await WhatsAppCampaign.findOne({
        'messages.messageId': msg.id._serialized
      });

      if (campaign) {
        const message = campaign.messages.find(m => m.messageId === msg.id._serialized);
        if (message) {
          switch (ack) {
            case 1: // Message sent
              message.status = 'sent';
              break;
            case 2: // Message delivered
              message.status = 'delivered';
              message.deliveredAt = new Date();
              break;
            case 3: // Message read
              message.status = 'read';
              message.readAt = new Date();
              break;
          }
          await campaign.save();
        }
      }
    } catch (error) {
      console.error('Error handling message ack:', error);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get QR code for account
  getQRCode(accountId) {
    return this.qrCodes.get(accountId);
  }

  // Disconnect account
  async disconnectAccount(accountId) {
    const client = this.clients.get(accountId);
    if (client) {
      await client.destroy();
      this.clients.delete(accountId);
      this.qrCodes.delete(accountId);
    }
  }

  // Get account status
  getAccountStatus(accountId) {
    const client = this.clients.get(accountId);
    return client ? 'connected' : 'disconnected';
  }
}

module.exports = new WhatsAppService();