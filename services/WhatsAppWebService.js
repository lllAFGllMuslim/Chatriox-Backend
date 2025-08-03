const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');

class WhatsAppWebService {
  constructor() {
    this.clients = new Map();
    this.qrCodes = new Map();
    this.sessionPath = path.join(__dirname, '../sessions');
    
    // Ensure sessions directory exists
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  // Initialize WhatsApp client for a user account
async initializeClient(accountId, userId, io = null) {
  try {
    // CRITICAL: Ensure accountId is always a string
    const accountIdString = accountId.toString();
    
    const account = await WhatsAppAccount.findOne({ _id: accountIdString, user: userId });
    if (!account) throw new Error('Account not found');

    console.log(`Initializing client for account: ${accountIdString}`);

    // Check if client already exists and is functional
    if (this.clients.has(accountIdString)) {
      const existingClient = this.clients.get(accountIdString);
      console.log(`Existing client found for account: ${accountIdString}`);
      
      // Check if the existing client is ready
      if (existingClient.info) {
        console.log(`Existing client is ready for account: ${accountIdString}`);
        return existingClient;
      } else {
        console.log(`Existing client not ready, cleaning up for account: ${accountIdString}`);
        // Clean up the non-ready client
        try {
          await existingClient.destroy();
        } catch (destroyError) {
          console.warn(`Error destroying existing client: ${destroyError.message}`);
        }
        this.clients.delete(accountIdString);
        this.qrCodes.delete(accountIdString);
      }
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: accountIdString,
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

    // CRITICAL: Store client with string key
    this.clients.set(accountIdString, client);
    console.log(`Client stored in map for account: ${accountIdString}`);

    // FIXED QR Code event handler
    client.on('qr', async (qr) => {
      console.log('QR Code generated for account:', accountIdString);
      console.log('QR Code data length:', qr.length);
      console.log('QR Code preview:', qr.substring(0, 50) + '...');
      
      // Store QR code locally
      this.qrCodes.set(accountIdString, qr);
      
      // Update account in database
      try {
        account.qrCode = qr;
        account.status = 'connecting';
        await account.save();
        console.log('Account updated with QR code in database');
      } catch (dbError) {
        console.error('Error saving QR to database:', dbError);
      }
      
      // CRITICAL FIX: Multiple emission methods
      console.log('Emitting QR code via multiple channels...');
      
      // Method 1: Use passed io parameter
      if (io) {
        console.log('Emitting via passed io parameter to room:', `user_${userId}`);
        io.to(`user_${userId}`).emit('qr_code', { 
          accountId: accountIdString, 
          qrCode: qr,
          timestamp: new Date().toISOString()
        });
        
        // Also broadcast to all sockets (backup)
        io.emit('qr_code_broadcast', { 
          accountId: accountIdString, 
          qrCode: qr,
          userId: userId,
          timestamp: new Date().toISOString()
        });
      }
      
      // Method 2: Use global.io if available
      if (global.io) {
        console.log('Emitting via global.io to room:', `user_${userId}`);
        global.io.to(`user_${userId}`).emit('qr_code', { 
          accountId: accountIdString, 
          qrCode: qr,
          timestamp: new Date().toISOString()
        });
      }
      
      // Method 3: Store globally for polling fallback
      global.latestQRCode = {
        accountId: accountIdString,
        qrCode: qr,
        userId: userId,
        timestamp: new Date()
      };
      
      console.log('QR code emission completed via all available channels');
    });

    // Rest of your existing event handlers...
    client.on('authenticated', async () => {
      console.log('WhatsApp authenticated for account:', accountIdString);
      
      try {
        account.status = 'authenticated';
        await account.save();
      } catch (dbError) {
        console.error('Error updating account status to authenticated:', dbError);
      }
      
      // Emit authentication event
      if (io) {
        io.to(`user_${userId}`).emit('whatsapp_authenticated', {
          accountId: accountIdString
        });
      }
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_authenticated', {
          accountId: accountIdString
        });
      }
    });

    client.on('ready', async () => {
      console.log('WhatsApp client ready for account:', accountIdString);
      
      // Double-check client is still in the map
      if (!this.clients.has(accountIdString)) {
        console.warn(`Client missing from map after ready event, re-adding: ${accountIdString}`);
        this.clients.set(accountIdString, client);
      }
      
      try {
        account.status = 'ready';
        account.lastActivity = new Date();
        
        const info = client.info;
        if (info && info.wid) {
          account.phoneNumber = info.wid.user;
        }
        
        await account.save();
      } catch (dbError) {
        console.error('Error updating account status to ready:', dbError);
      }
      
      console.log(`Client ready and verified in map for account: ${accountIdString}, Phone: ${account.phoneNumber}`);
      
      // Emit ready event
      if (io) {
        io.to(`user_${userId}`).emit('whatsapp_ready', { 
          accountId: accountIdString, 
          phoneNumber: account.phoneNumber,
          profileName: client.info?.pushname || 'Unknown'
        });
      }
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_ready', { 
          accountId: accountIdString, 
          phoneNumber: account.phoneNumber,
          profileName: client.info?.pushname || 'Unknown'
        });
      }
    });

    client.on('disconnected', async (reason) => {
      console.log(`WhatsApp disconnected for account: ${accountIdString}. Reason:`, reason);
      
      try {
        account.status = 'disconnected';
        account.isConnected = false;
        await account.save();
      } catch (dbError) {
        console.error('Error updating account status to disconnected:', dbError);
      }

      // Emit disconnection event
      if (io) {
        io.to(`user_${userId}`).emit('whatsapp_disconnected', {
          accountId: accountIdString,
          reason: reason
        });
      }
      if (global.io) {
        global.io.to(`user_${userId}`).emit('whatsapp_disconnected', {
          accountId: accountIdString,
          reason: reason
        });
      }
    });

    console.log(`Starting client initialization for account: ${accountIdString}`);
    await client.initialize();

    return client;
  } catch (error) {
    console.error('Error initializing WhatsApp client:', error);
    const accountIdString = accountId.toString();
    if (this.clients.has(accountIdString)) {
      const client = this.clients.get(accountIdString);
      try {
        await client.destroy();
      } catch (destroyError) {
        console.warn(`Error destroying client on initialization error: ${destroyError.message}`);
      }
      this.clients.delete(accountIdString);
    }
    throw error;
  }
}


// Send message with anti-blocking features
// Enhanced sendMessage method with better client validation
async sendMessage(accountId, recipient, content, options = {}) {
  try {
    console.log(`Attempting to send message for account: ${accountId}`);
    console.log(`Available clients in map: ${Array.from(this.clients.keys())}`);
    console.log(`Message content:`, content);
    console.log(`Recipient:`, recipient);
    
    const client = this.clients.get(accountId);
    if (!client) {
      console.error(`WhatsApp client not found for account: ${accountId}`);
      console.log(`Clients in map: ${Array.from(this.clients.keys())}`);
      throw new Error('WhatsApp client not found. Please reconnect your WhatsApp account.');
    }

    console.log(`Client found for account: ${accountId}, checking readiness...`);

    // Check if client is properly initialized and ready
    if (!client.info) {
      console.error(`WhatsApp client not ready for account: ${accountId}`);
      throw new Error('WhatsApp client not ready. Please wait for connection to complete.');
    }

    console.log(`Client is ready for account: ${accountId}, Phone: ${client.info.wid?.user}`);

    // Validate client state
    try {
      const state = await client.getState();
      console.log(`Client state for account ${accountId}: ${state}`);
      if (state !== 'CONNECTED') {
        throw new Error(`WhatsApp client not connected. Current state: ${state}. Please reconnect.`);
      }
    } catch (stateError) {
      console.error(`Error getting client state for account ${accountId}:`, stateError);
      throw new Error('Unable to verify WhatsApp connection. Please reconnect your account.');
    }

    const account = await WhatsAppAccount.findById(accountId);
    if (!account) {
      throw new Error('WhatsApp account not found in database');
    }

    // Update account status if client is ready but DB shows otherwise
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

    // Apply random delay
    if (options.randomDelay) {
      const delay = Math.random() * (options.maxDelay || 5000) + (options.minDelay || 1000);
      await this.sleep(delay);
    }

    let message;
    // Improved phone number formatting
    let phoneNumber = recipient.replace(/\D/g, '');
    
    // Add country code if missing (assuming India +91)
    if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
      phoneNumber = '91' + phoneNumber;
    }
    
    // Ensure phone number is valid
    if (phoneNumber.length < 10) {
      throw new Error(`Invalid phone number: ${recipient}. Must be at least 10 digits.`);
    }
    
    const chatId = `${phoneNumber}@c.us`;
    console.log(`Sending message to: ${chatId}`);
    
    // Validate content before sending
    if (!content || !content.type) {
      throw new Error('Message content and type are required');
    }

    // Send different types of messages
    switch (content.type) {
      case 'text':
        if (!content.text || content.text.trim() === '') {
          throw new Error('Text content cannot be empty');
        }
        console.log(`Sending text message: "${content.text}"`);
        try {
          // Check if number exists on WhatsApp
          const numberId = await client.getNumberId(chatId);
          if (!numberId) {
            throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
          }
          message = await client.sendMessage(chatId, content.text);
        } catch (sendError) {
          console.error(`Error sending to ${chatId}:`, sendError);
          throw new Error(`Failed to send message to ${phoneNumber}: ${sendError.message}`);
        }
        break;
        
      case 'image':
        let imagePath = content.mediaPath;
        
        // If no mediaPath but we have fileName, construct the path
        if (!imagePath && content.fileName) {
          imagePath = path.join(__dirname, '../uploads/whatsapp/', content.fileName);
        }
        
        if (imagePath && fs.existsSync(imagePath)) {
          const imageMedia = MessageMedia.fromFilePath(imagePath);
          const numberId = await client.getNumberId(chatId);
          if (!numberId) {
            throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
          }
          message = await client.sendMessage(chatId, imageMedia, { caption: content.text || content.caption || '' });
        } else if (content.mediaUrl) {
          const imageMedia = await MessageMedia.fromUrl(content.mediaUrl);
          const numberId = await client.getNumberId(chatId);
          if (!numberId) {
            throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
          }
          message = await client.sendMessage(chatId, imageMedia, { caption: content.text || content.caption || '' });
        } else {
          console.log('Debug - No valid image source:', { 
            mediaPath: content.mediaPath, 
            fileName: content.fileName, 
            mediaUrl: content.mediaUrl 
          });
          throw new Error('No valid image source provided');
        }
        break;
          
      case 'video':
        let videoPath = content.mediaPath;
        
        // If no mediaPath but we have fileName, construct the path
        if (!videoPath && content.fileName) {
          videoPath = path.join(__dirname, '../uploads/whatsapp/', content.fileName);
        }
        
        if (videoPath && fs.existsSync(videoPath)) {
          try {
            // Check if number exists on WhatsApp
            const numberId = await client.getNumberId(chatId);
            if (!numberId) {
              throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
            }

            // Create video media object
            const videoMedia = MessageMedia.fromFilePath(videoPath);
            
            // Send as document (this works reliably)
            message = await client.sendMessage(chatId, videoMedia, { 
              caption: content.text || content.caption || '',
              sendMediaAsDocument: true
            });
            
            console.log('✅ Video sent successfully as document!');
            
          } catch (videoError) {
            console.error('Error sending video:', videoError);
            throw new Error(`Failed to send video: ${videoError.message}`);
          }
          
        } else if (content.mediaUrl) {
          try {
            const videoMedia = await MessageMedia.fromUrl(content.mediaUrl);
            const numberId = await client.getNumberId(chatId);
            if (!numberId) {
              throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
            }
            
            message = await client.sendMessage(chatId, videoMedia, { 
              caption: content.text || content.caption || '',
              sendMediaAsDocument: true
            });
            
          } catch (urlError) {
            throw new Error(`Failed to fetch video from URL: ${urlError.message}`);
          }
        } else {
          throw new Error('No valid video source provided');
        }
        break;  
        default:
        throw new Error('Unsupported message type');
    }

    console.log(`Message sent successfully for account: ${accountId}, Message ID: ${message.id._serialized}`);

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
    console.error(`Error sending message for account ${accountId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}
logClientStatus() {
  console.log('=== Client Status Report ===');
  console.log(`Total clients in map: ${this.clients.size}`);
  
  for (const [accountId, client] of this.clients.entries()) {
    console.log(`Account ${accountId}:`);
    console.log(`  - Client exists: true`);
    console.log(`  - Client info: ${client.info ? 'Ready' : 'Not ready'}`);
    console.log(`  - Phone: ${client.info?.wid?.user || 'Unknown'}`);
  }
  console.log('=== End Status Report ===');
}
async connectWhatsApp(accountId, userId) {
  try {
    console.log(`Connect request for account: ${accountId}`);
    this.logClientStatus();
    
    // Check if already connected and ready
    if (this.clients.has(accountId)) {
      const existingClient = this.clients.get(accountId);
      if (existingClient.info) {
        console.log(`Account ${accountId} already connected and ready`);
        return {
          success: true,
          message: 'Already connected',
          qrCode: null
        };
      }
    }

    // Initialize new client
    const client = await this.initializeClient(accountId, userId);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 60000); // 1 minute timeout

      // If client becomes ready during initialization
      if (client.info) {
        clearTimeout(timeout);
        resolve({
          success: true,
          message: 'Connected successfully',
          qrCode: null
        });
        return;
      }

      // Wait for QR or ready event
      client.once('qr', (qr) => {
        clearTimeout(timeout);
        resolve({
          success: true,
          message: 'QR code generated',
          qrCode: qr
        });
      });

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve({
          success: true,
          message: 'Connected successfully',
          qrCode: null
        });
      });

      client.once('auth_failure', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Authentication failed: ${error}`));
      });
    });

  } catch (error) {
    console.error('Connect WhatsApp error:', error);
    throw error;
  }
}


// Add a method to check client health
async checkClientHealth(accountId) {
  try {
    const client = this.clients.get(accountId);
    if (!client) {
      return { healthy: false, status: 'not_found', message: 'Client not found' };
    }

    if (!client.info) {
      return { healthy: false, status: 'not_ready', message: 'Client not ready' };
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
      return { healthy: false, status: state, message: `Client state: ${state}` };
    }

    // Try to get client info to ensure it's responsive
    const info = client.info;
    return { 
      healthy: true, 
      status: 'connected', 
      message: 'Client healthy',
      phoneNumber: info.wid?.user,
      profileName: info.pushname
    };

  } catch (error) {
    return { 
      healthy: false, 
      status: 'error', 
      message: error.message 
    };
  }
}

// Enhanced getAccountStatus method
getAccountStatus(accountId) {
  const client = this.clients.get(accountId);
  if (!client) {
    return { status: 'disconnected', message: 'Client not found' };
  }
  
  if (!client.info) {
    return { status: 'connecting', message: 'Client initializing' };
  }
  
  return { 
    status: 'ready', 
    message: 'Client ready',
    phoneNumber: client.info.wid?.user,
    profileName: client.info.pushname
  };
}

  // Process campaign with advanced features
async processCampaign(campaignId) {
  try {
    console.log(`Starting campaign processing for: ${campaignId}`);
    
    const campaign = await WhatsAppCampaign.findById(campaignId)
      .populate('whatsappAccount')
      .populate('user');

    if (!campaign) throw new Error('Campaign not found');

    console.log(`Campaign found with ${campaign.messages.length} messages`);

    campaign.status = 'running';
    campaign.startedAt = new Date();
    await campaign.save();

    // CRITICAL FIX: Ensure consistent string conversion
    const accountId = campaign.whatsappAccount._id.toString();
    console.log(`Looking for client with accountId: ${accountId}`);
    console.log(`Available clients: ${Array.from(this.clients.keys())}`);

    const client = this.clients.get(accountId);

    // Enhanced client validation
    if (!client) {
      console.error(`WhatsApp client not found for account ${accountId}`);
      throw new Error(`WhatsApp client not found for account ${accountId}. Please reconnect.`);
    }

    console.log(`Client found for account: ${accountId}`);

    if (!client.info) {
      console.error(`WhatsApp client not ready for account ${accountId}`);
      throw new Error(`WhatsApp client not ready for account ${accountId}. Please wait for connection.`);
    }

    console.log(`Client is ready for account: ${accountId}`);

    // Verify client state before starting campaign
    try {
      const state = await client.getState();
      console.log(`Client state for account ${accountId}: ${state}`);
      if (state !== 'CONNECTED') {
        throw new Error(`WhatsApp client not connected. State: ${state}`);
      }
    } catch (stateError) {
      throw new Error(`Unable to verify WhatsApp connection: ${stateError.message}`);
    }

    const { antiBlockSettings = {} } = campaign;
    
    // Get pending messages
    const pendingMessages = campaign.messages.filter(m => m.status === 'pending');
    const batchSize = antiBlockSettings.maxMessagesPerBatch || 50;
    
    let totalSent = 0;
    let totalFailed = 0;

    console.log(`Processing ${pendingMessages.length} pending messages in batches of ${batchSize}`);

    // Process messages in batches
    for (let i = 0; i < pendingMessages.length; i += batchSize) {
      const batch = pendingMessages.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pendingMessages.length/batchSize)}`);
      
      // Process batch
      for (const [index, message] of batch.entries()) {
        try {
          // CRITICAL: Check if client is still connected before each message
          const currentClient = this.clients.get(accountId);
          if (!currentClient || !currentClient.info) {
            throw new Error('WhatsApp client disconnected during campaign');
          }

          // Apply content variation if enabled
          let content = message.content;
          if (antiBlockSettings.contentVariation) {
            content = await this.applyContentVariation(content);
          }

          console.log(`Sending message ${i + index + 1}/${pendingMessages.length} to ${message.recipient.phone}`);

          // Send message with enhanced options
          const result = await this.sendMessage(
            accountId, // CRITICAL: Use the string version consistently
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
            console.log(`✅ Message sent successfully to ${message.recipient.phone}`);
          } else {
            message.status = 'failed';
            message.failureReason = result.error;
            totalFailed++;
            console.log(`❌ Message failed to ${message.recipient.phone}: ${result.error}`);
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

          // Add delay between messages to avoid rate limiting
          if (index < batch.length - 1) {
            const delay = antiBlockSettings.messageDelay || 3000;
            const randomDelay = Math.random() * delay;
            await this.sleep(delay + randomDelay);
          }

        } catch (error) {
          console.error(`Error processing message to ${message.recipient.phone}:`, error);
          message.status = 'failed';
          message.failureReason = error.message;
          totalFailed++;
          
          // If it's a critical client error, stop the campaign
          if (error.message.includes('client disconnected') || 
              error.message.includes('client not found')) {
            console.log('Critical client error, stopping campaign');
            break;
          }
          
          // Add delay after failed message to prevent rate limiting
          await this.sleep(2000);
        }
      }

      // Save progress after each batch
      await campaign.save();

      // Batch delay (if not the last batch)
      if (i + batchSize < pendingMessages.length) {
        const batchDelay = antiBlockSettings.batchDelay || 180000; // 3 minutes default
        console.log(`Waiting ${batchDelay/1000} seconds before next batch...`);
        await this.sleep(batchDelay);
      }
    }

    campaign.status = totalFailed === 0 ? 'completed' : 'partial';
    campaign.completedAt = new Date();
    await campaign.save();

    console.log(`Campaign ${campaignId} completed. Sent: ${totalSent}, Failed: ${totalFailed}`);

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
        error: error.message,
        completedAt: new Date()
      });
    } catch (updateError) {
      console.error('Error updating failed campaign:', updateError);
    }

    throw error;
  }
}

  // Handle message acknowledgments
  async handleMessageAck(msg, ack, accountId) {
    try {
      const message = await WhatsAppMessage.findOne({
        messageId: msg.id._serialized
      });

      if (message) {
        switch (ack) {
          case 1: // Message sent
            message.status = 'sent';
            message.sentAt = new Date();
            break;
          case 2: // Message delivered
            message.status = 'delivered';
            message.deliveredAt = new Date();
            break;
          case 3: // Message read
            message.status = 'read';
            message.readAt = new Date();
            message.analytics.timeToRead = message.readAt - message.sentAt;
            break;
        }
        
        await message.save();

        // Update campaign if exists
        if (message.campaign) {
          const campaign = await WhatsAppCampaign.findById(message.campaign);
          if (campaign) {
            const campaignMessage = campaign.messages.find(m => m.messageId === msg.id._serialized);
            if (campaignMessage) {
              campaignMessage.status = message.status;
              campaignMessage.deliveredAt = message.deliveredAt;
              campaignMessage.readAt = message.readAt;
              await campaign.save();
            }
          }
        }

        // Emit real-time update
        if (global.io) {
          global.io.to(`user_${message.user}`).emit('message_status_update', {
            messageId: message._id,
            status: message.status,
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      console.error('Error handling message ack:', error);
    }
  }

  // Anti-blocking helper methods
  async simulateTyping(textLength) {
    const typingTime = Math.min(textLength * 50, 5000); // Max 5 seconds
    await this.sleep(typingTime);
  }

  async applyContentVariation(content) {
    if (content.type !== 'text') return content;
    
    const variations = [
      (text) => text,
      (text) => text + ' 😊',
      (text) => text + '\n\nBest regards!',
      (text) => 'Hi! ' + text,
      (text) => text.replace(/\./g, '...'),
      (text) => text + '\n\nHave a great day!',
      (text) => 'Hello! ' + text,
      (text) => text + ' 👍'
    ];
    
    const randomVariation = variations[Math.floor(Math.random() * variations.length)];
    return {
      ...content,
      text: randomVariation(content.text)
    };
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

    // Clean up session files
    const sessionDir = path.join(this.sessionPath, `session-${accountId}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  // Get account status
  getAccountStatus(accountId) {
    const client = this.clients.get(accountId);
    return client && client.info ? 'ready' : 'disconnected';
  }

  // Get all connected clients
  getConnectedAccounts() {
    const connected = [];
    for (const [accountId, client] of this.clients.entries()) {
      if (client.info) {
        connected.push({
          accountId,
          phoneNumber: client.info.wid?.user,
          profileName: client.info.pushname
        });
      }
    }
    return connected;
  }
}

module.exports = new WhatsAppWebService();