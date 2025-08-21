const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const QRCode = require('qrcode');
const path = require('path');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');

class WhatsAppWebService {
  constructor() {
    this.clients = new Map();
    this.qrCodes = new Map();
    this.sessionPath = path.join(__dirname, '../sessions');
    this.connectionHealth = new Map();
    this.reconnectAttempts = new Map();
    this.initializingClients = new Set(); // Track clients being initialized
    
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }

    // Start health monitoring
    this.startHealthMonitor();
  }

  // Enhanced client initialization with better error handling
  async initializeClient(accountId, userId, io = null) {
    const accountIdStr = accountId.toString();
    
    // Prevent multiple simultaneous initializations
    if (this.initializingClients.has(accountIdStr)) {
      throw new Error('Client initialization already in progress');
    }
    
    this.initializingClients.add(accountIdStr);
    
    try {
      console.log(`🔄 Initializing client for account: ${accountIdStr}`);

      // Get account from database
      const account = await WhatsAppAccount.findOne({ _id: accountIdStr, user: userId });
      if (!account) {
        throw new Error('Account not found in database');
      }

      // Force cleanup any existing client and session
      await this.forceCleanupClient(accountIdStr);
      
      // Wait a bit after cleanup
      await this.sleep(2000);

      // Create new client with enhanced settings
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: accountIdStr,
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
            '--disable-features=VizDisplayCompositor',
            '--memory-pressure-off',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ],
          timeout: 60000 // 60 second timeout
        },
        // Add session restore timeout
        restartOnAuthFail: true,
        qrMaxRetries: 3
      });

      // Store client immediately
      this.clients.set(accountIdStr, client);
      this.connectionHealth.set(accountIdStr, { status: 'initializing', lastCheck: Date.now() });

      // Setup event handlers with enhanced error handling
      this.setupClientEvents(client, accountIdStr, userId, account, io);

      // Initialize client with timeout
      const initPromise = client.initialize();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Client initialization timeout')), 90000); // 90 seconds
      });

      await Promise.race([initPromise, timeoutPromise]);
      
      console.log(`✅ Client initialized successfully for account: ${accountIdStr}`);
      return client;

    } catch (error) {
      console.error(`❌ Client initialization failed for ${accountIdStr}:`, error.message);
      
      // Cleanup on failure
      await this.forceCleanupClient(accountIdStr);
      
      // Update database status
      try {
        await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
          status: 'failed',
          errorMessage: error.message,
          updatedAt: new Date()
        });
      } catch (dbError) {
        console.error('Database update failed:', dbError);
      }

      throw error;
    } finally {
      this.initializingClients.delete(accountIdStr);
    }
  }

  setupClientEvents(client, accountIdStr, userId, account, io) {
    // Handle client errors first
    client.on('error', (error) => {
      console.error(`🚫 Client error for ${accountIdStr}:`, error);
      this.handleClientError(accountIdStr, userId, error, io);
    });

    client.on('qr', async (qr) => {
      try {
        console.log(`📱 QR Code generated for account: ${accountIdStr}`);
        const dataUrl = await QRCode.toDataURL(qr);
        this.qrCodes.set(accountIdStr, dataUrl);
        
        try {
          account.qrCode = dataUrl;
          account.status = 'connecting';
          await account.save();
        } catch (dbErr) {
          console.error('Failed to save QR dataUrl to database:', dbErr);
        }

        this.emitToUser(userId, 'qr_code', {
          accountId: accountIdStr,
          qrCode: dataUrl,
          timestamp: new Date().toISOString()
        }, io);
      } catch (err) {
        console.error('Failed to convert QR to data URL:', err);
        this.handleClientError(accountIdStr, userId, err, io);
      }
    });

    client.on('authenticated', async () => {
      console.log(`✅ Authenticated for account: ${accountIdStr}`);
      try {
        account.status = 'authenticated';
        account.qrCode = null;
        await account.save();
      } catch (error) {
        console.error('Database update failed:', error);
      }
      this.qrCodes.delete(accountIdStr);
      this.emitToUser(userId, 'whatsapp_authenticated', { accountId: accountIdStr }, io);
    });

    client.on('ready', async () => {
      console.log(`🚀 Client ready for account: ${accountIdStr}`);
      
      this.connectionHealth.set(accountIdStr, { 
        status: 'ready', 
        lastCheck: Date.now(),
        phoneNumber: client.info?.wid?.user 
      });

      try {
        account.status = 'ready';
        account.isConnected = true;
        account.lastActivity = new Date();
        
        if (client.info?.wid) {
          account.phoneNumber = client.info.wid.user;
        }
        
        await account.save();
      } catch (error) {
        console.error('Database update failed:', error);
      }

      this.emitToUser(userId, 'whatsapp_ready', {
        accountId: accountIdStr,
        phoneNumber: account.phoneNumber,
        profileName: client.info?.pushname || 'Unknown'
      }, io);

      // Reset reconnection attempts on successful connection
      this.reconnectAttempts.delete(accountIdStr);
    });

    client.on('disconnected', async (reason) => {
      console.log(`🔌 Client disconnected for ${accountIdStr}. Reason: ${reason}`);
      
      this.connectionHealth.set(accountIdStr, { 
        status: 'disconnected', 
        lastCheck: Date.now() 
      });

      try {
        account.status = 'disconnected';
        account.isConnected = false;
        account.errorMessage = `Disconnected: ${reason}`;
        await account.save();
      } catch (error) {
        console.error('Database update failed:', error);
      }

      this.emitToUser(userId, 'whatsapp_disconnected', {
        accountId: accountIdStr,
        reason: reason
      }, io);

      // Clean up the disconnected client
      await this.safeCleanupClient(accountIdStr);

      // Attempt reconnection for unexpected disconnects (but not for logout or navigation)
      if (reason !== 'LOGOUT' && reason !== 'NAVIGATION' && !reason.includes('Protocol error')) {
        this.scheduleReconnection(accountIdStr, userId, io);
      }
    });

    client.on('auth_failure', async (error) => {
      console.log(`🚫 Auth failure for ${accountIdStr}:`, error);
      
      this.connectionHealth.set(accountIdStr, { 
        status: 'auth_failed', 
        lastCheck: Date.now() 
      });

      try {
        account.status = 'failed';
        account.errorMessage = 'Authentication failed - please reconnect';
        await account.save();
      } catch (dbError) {
        console.error('Database update failed:', dbError);
      }

      await this.safeCleanupClient(accountIdStr);

      this.emitToUser(userId, 'whatsapp_auth_failed', {
        accountId: accountIdStr,
        error: error.toString()
      }, io);
    });

    // Message acknowledgment tracking
    client.on('message_ack', (msg, ack) => {
      this.handleMessageAck(msg, ack, accountIdStr).catch(console.error);
    });
  }

  // New method to handle client errors gracefully
  async handleClientError(accountIdStr, userId, error, io) {
    console.error(`🚫 Handling client error for ${accountIdStr}:`, error.message);
    
    this.connectionHealth.set(accountIdStr, { 
      status: 'error', 
      lastCheck: Date.now(),
      error: error.message
    });

    try {
      const account = await WhatsAppAccount.findById(accountIdStr);
      if (account) {
        account.status = 'failed';
        account.errorMessage = error.message;
        await account.save();
      }
    } catch (dbError) {
      console.error('Database update failed:', dbError);
    }

    // Clean up the problematic client
    await this.safeCleanupClient(accountIdStr);

    this.emitToUser(userId, 'whatsapp_error', {
      accountId: accountIdStr,
      error: error.message
    }, io);
  }

  // Safe cleanup method with proper error handling
  async safeCleanupClient(accountId) {
    const accountIdStr = accountId.toString();
    
    try {
      const client = this.clients.get(accountIdStr);
      if (client) {
        // Try to destroy the client gracefully
        try {
          if (client.pupBrowser) {
            const pages = await client.pupBrowser.pages();
            for (const page of pages) {
              try {
                if (!page.isClosed()) {
                  await page.close();
                }
              } catch (pageError) {
                console.error(`Error closing page: ${pageError.message}`);
              }
            }
          }
          
          await client.destroy();
        } catch (destroyError) {
          console.error(`Error destroying client ${accountIdStr}:`, destroyError.message);
          
          // Force kill the browser process if destroy fails
          if (client.pupBrowser && client.pupBrowser.process()) {
            try {
              client.pupBrowser.process().kill('SIGKILL');
            } catch (killError) {
              console.error(`Error killing browser process: ${killError.message}`);
            }
          }
        }
        
        this.clients.delete(accountIdStr);
      }
      
      this.qrCodes.delete(accountIdStr);
      this.connectionHealth.delete(accountIdStr);
      
    } catch (error) {
      console.error(`Error in safeCleanupClient for ${accountIdStr}:`, error.message);
    }
  }

  // Force cleanup with session deletion
  async forceCleanupClient(accountId) {
    const accountIdStr = accountId.toString();
    
    await this.safeCleanupClient(accountIdStr);
    
    // Also remove session files
    const sessionDir = path.join(this.sessionPath, `session-${accountIdStr}`);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`🗑️ Removed session directory for ${accountIdStr}`);
      } catch (error) {
        console.error(`Failed to remove session ${accountIdStr}:`, error);
      }
    }
    
    this.reconnectAttempts.delete(accountIdStr);
  }

  // Enhanced message sending with connection validation
  async sendMessage(accountId, recipient, content, options = {}) {
    const accountIdStr = accountId.toString();
    
    try {
      console.log(`📤 Sending message for account: ${accountIdStr} to ${recipient}`);

      const client = this.clients.get(accountIdStr);
      if (!client) {
        throw new Error('WhatsApp client not found. Please reconnect your account.');
      }

      // Enhanced connection validation
      if (!client.info) {
        throw new Error('WhatsApp client not ready. Please wait for connection.');
      }

      // Check if client is still alive
      try {
        const state = await Promise.race([
          client.getState(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('State check timeout')), 10000)
          )
        ]);
        
        if (state !== 'CONNECTED') {
          this.connectionHealth.set(accountIdStr, { 
            status: 'disconnected', 
            lastCheck: Date.now() 
          });
          
          const account = await WhatsAppAccount.findById(accountIdStr);
          if (account) {
            account.status = 'disconnected';
            account.errorMessage = `Connection lost - state: ${state}`;
            await account.save();
          }

          throw new Error(`WhatsApp not connected. Current state: ${state}`);
        }
      } catch (stateError) {
        if (stateError.message.includes('timeout') || stateError.message.includes('Protocol error')) {
          throw new Error('WhatsApp client connection lost. Please reconnect.');
        }
        throw stateError;
      }

      // Rest of the sendMessage logic remains the same...
      let phoneNumber = recipient.replace(/\D/g, '');
      if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
        phoneNumber = '91' + phoneNumber;
      }

      if (phoneNumber.length < 10) {
        throw new Error('Invalid phone number format');
      }

      const chatId = `${phoneNumber}@c.us`;

      // Check if number exists on WhatsApp with timeout
      const numberId = await Promise.race([
        client.getNumberId(chatId),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Number check timeout')), 15000)
        )
      ]);
      
      if (!numberId) {
        throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
      }

      // Apply delays if requested
      if (options.humanTyping && content.text) {
        await this.simulateTyping(content.text.length);
      }

      if (options.randomDelay) {
        const delay = Math.random() * (options.maxDelay || 5000) + (options.minDelay || 1000);
        await this.sleep(delay);
      }

      // Send message based on type
      let message;
      switch (content.type) {
        case 'text':
          if (!content.text?.trim()) {
            throw new Error('Text content cannot be empty');
          }
          message = await client.sendMessage(chatId, content.text);
          break;

        case 'image':
          const imagePath = content.mediaPath || 
            (content.fileName ? path.join(__dirname, '../uploads/whatsapp/', content.fileName) : null);
          
          if (imagePath && fs.existsSync(imagePath)) {
            const imageMedia = MessageMedia.fromFilePath(imagePath);
            message = await client.sendMessage(chatId, imageMedia, { 
              caption: content.text || content.caption || '' 
            });
          } else if (content.mediaUrl) {
            const imageMedia = await MessageMedia.fromUrl(content.mediaUrl);
            message = await client.sendMessage(chatId, imageMedia, { 
              caption: content.text || content.caption || '' 
            });
          } else {
            throw new Error('No valid image source provided');
          }
          break;

        case 'video':
          const videoPath = content.mediaPath || 
            (content.fileName ? path.join(__dirname, '../uploads/whatsapp/', content.fileName) : null);
          
          if (videoPath && fs.existsSync(videoPath)) {
            const videoMedia = MessageMedia.fromFilePath(videoPath);
            message = await client.sendMessage(chatId, videoMedia, {
              caption: content.text || content.caption || '',
              sendMediaAsDocument: true
            });
          } else if (content.mediaUrl) {
            const videoMedia = await MessageMedia.fromUrl(content.mediaUrl);
            message = await client.sendMessage(chatId, videoMedia, {
              caption: content.text || content.caption || '',
              sendMediaAsDocument: true
            });
          } else {
            throw new Error('No valid video source provided');
          }
          break;

        default:
          throw new Error('Unsupported message type');
      }

      // Update account statistics
      const account = await WhatsAppAccount.findById(accountIdStr);
      if (account) {
        account.dailyMessageCount += 1;
        account.lastActivity = new Date();
        await account.save();
      }

      console.log(`✅ Message sent successfully: ${message.id._serialized}`);

      return {
        success: true,
        messageId: message.id._serialized,
        timestamp: new Date(),
        chatId: message.to
      };

    } catch (error) {
      console.error(`❌ Send message failed for ${accountIdStr}:`, error.message);
      
      // If it's a connection error, mark client as unhealthy
      if (error.message.includes('Protocol error') || 
          error.message.includes('Session closed') ||
          error.message.includes('connection lost') ||
          error.message.includes('timeout')) {
        await this.safeCleanupClient(accountIdStr);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Enhanced reconnection with better timing
  scheduleReconnection(accountId, userId, io) {
    const attempts = this.reconnectAttempts.get(accountId) || 0;
    if (attempts >= 3) {
      console.log(`❌ Max reconnection attempts reached for ${accountId}`);
      return;
    }

    const delay = Math.min(10000 * Math.pow(2, attempts), 60000); // Longer delays
    this.reconnectAttempts.set(accountId, attempts + 1);

    console.log(`⏰ Scheduling reconnection for ${accountId} in ${delay/1000}s (attempt ${attempts + 1})`);

    setTimeout(async () => {
      try {
        console.log(`🔄 Attempting reconnection for ${accountId} (attempt ${attempts + 1})`);
        await this.initializeClient(accountId, userId, io);
        this.reconnectAttempts.delete(accountId);
      } catch (error) {
        console.error(`Reconnection failed for ${accountId}:`, error.message);
      }
    }, delay);
  }

  // Enhanced health monitor with better error handling
  startHealthMonitor() {
    setInterval(async () => {
      const clientEntries = Array.from(this.clients.entries());
      
      for (const [accountId, client] of clientEntries) {
        try {
          if (client && client.info) {
            const statePromise = client.getState();
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Health check timeout')), 10000)
            );
            
            const state = await Promise.race([statePromise, timeoutPromise]);
            const health = this.connectionHealth.get(accountId);
            
            if (state !== 'CONNECTED') {
              console.log(`🩺 Health check failed for ${accountId}: ${state}`);
              
              this.connectionHealth.set(accountId, {
                status: 'unhealthy',
                lastCheck: Date.now(),
                lastState: state
              });

              const account = await WhatsAppAccount.findById(accountId);
              if (account && account.status === 'ready') {
                account.status = 'disconnected';
                account.errorMessage = `Health check failed: ${state}`;
                await account.save();

                this.emitToUser(account.user, 'whatsapp_disconnected', {
                  accountId: accountId,
                  reason: 'Health check failed'
                });
              }

              await this.safeCleanupClient(accountId);
            } else if (health?.status !== 'ready') {
              this.connectionHealth.set(accountId, {
                status: 'ready',
                lastCheck: Date.now()
              });
            }
          }
        } catch (error) {
          console.log(`🩺 Health check error for ${accountId}:`, error.message);
          
          // If it's a session closed error, clean up the client
          if (error.message.includes('Protocol error') || 
              error.message.includes('Session closed') ||
              error.message.includes('timeout')) {
            await this.safeCleanupClient(accountId);
          }
        }
      }
    }, 45000); // Check every 45 seconds (less frequent to reduce load)
  }

  // Enhanced disconnect method
  // Enhanced disconnect method that properly logs out from WhatsApp servers
async disconnectAccount(accountId, userId = null, io = null) {
  const accountIdStr = accountId.toString();
  
  try {
    console.log(`🔌 Disconnecting account: ${accountIdStr}`);
    
    const account = await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
      status: 'disconnecting',
      updatedAt: new Date()
    });

    if (!account) {
      throw new Error('Account not found in database');
    }

    if (userId && io) {
      this.emitToUser(userId, 'whatsapp_disconnecting', {
        accountId: accountIdStr
      }, io);
    }

    const client = this.clients.get(accountIdStr);
    let loggedOut = false;

    if (client) {
      try {
        // Try to logout gracefully from WhatsApp servers
        if (client.info) {
          console.log(`🚪 Logging out from WhatsApp servers for account: ${accountIdStr}`);
          
          await Promise.race([
            client.logout().then(() => {
              loggedOut = true;
              console.log(`✅ Successfully logged out from WhatsApp servers: ${accountIdStr}`);
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Logout timeout after 15 seconds')), 15000)
            )
          ]);
        }
      } catch (logoutError) {
        console.error(`❌ Logout failed for ${accountIdStr}:`, logoutError.message);
        
        // If standard logout fails, try alternative method to remove from linked devices
        if (logoutError.message.includes('timeout') || 
            logoutError.message.includes('Protocol error') ||
            logoutError.message.includes('Session closed')) {
          
          console.log(`🔄 Trying alternative logout method for ${accountIdStr}`);
          try {
            // Try to send logout command directly via browser context
            if (client.pupPage && !client.pupPage.isClosed()) {
              await Promise.race([
                client.pupPage.evaluate(() => {
                  // Try multiple logout methods in browser context
                  try {
                    // Method 1: Use Store.AppState if available
                    if (window.Store && window.Store.AppState && window.Store.AppState.logout) {
                      window.Store.AppState.logout();
                      return true;
                    }
                    
                    // Method 2: Try to find and click logout in menu
                    const menuButton = document.querySelector('[data-testid="menu"]');
                    if (menuButton) {
                      menuButton.click();
                      setTimeout(() => {
                        const logoutButton = document.querySelector('[data-testid="mi-logout"]');
                        if (logoutButton) {
                          logoutButton.click();
                        }
                      }, 1000);
                      return true;
                    }
                    
                    // Method 3: Direct navigation to logout
                    if (window.location) {
                      window.location.href = 'https://web.whatsapp.com/logout';
                      return true;
                    }
                    
                    return false;
                  } catch (e) {
                    console.error('Browser logout failed:', e);
                    return false;
                  }
                }),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Alternative logout timeout')), 10000)
                )
              ]);
              
              loggedOut = true;
              console.log(`✅ Alternative logout successful: ${accountIdStr}`);
              
              // Wait for logout to process
              await this.sleep(3000);
            }
          } catch (altLogoutError) {
            console.error(`Alternative logout also failed: ${altLogoutError.message}`);
          }
        }
      }
    }

    // Force cleanup with session deletion (this removes local session)
    await this.forceCleanupClient(accountIdStr);

    // Update database status with logout information
    await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
      status: 'disconnected',
      isConnected: false,
      phoneNumber: null,
      qrCode: null,
      errorMessage: loggedOut ? 'Properly logged out from WhatsApp servers' : 'Disconnected locally (server logout may have failed)',
      lastActivity: new Date(),
      updatedAt: new Date()
    });

    const successMessage = loggedOut ? 
      'Account disconnected and removed from WhatsApp linked devices' : 
      'Account disconnected locally (removal from linked devices may have failed)';

    console.log(`✅ Successfully disconnected account: ${accountIdStr} ${loggedOut ? '(with proper server logout)' : '(local cleanup only)'}`);

    if (userId && io) {
      this.emitToUser(userId, 'whatsapp_disconnected', {
        accountId: accountIdStr,
        reason: 'Manual disconnect',
        properLogout: loggedOut,
        removedFromLinkedDevices: loggedOut
      }, io);
    }

    return { 
      success: true, 
      message: successMessage,
      properLogout: loggedOut,
      removedFromLinkedDevices: loggedOut
    };

  } catch (error) {
    console.error(`❌ Failed to disconnect account ${accountIdStr}:`, error.message);
    
    try {
      await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
        status: 'failed',
        errorMessage: `Disconnect failed: ${error.message}`,
        updatedAt: new Date()
      });
    } catch (dbError) {
      console.error('Database update failed:', dbError);
    }

    throw error;
  }
}

  // Process campaign method remains mostly the same but with enhanced client checking
  async processCampaign(campaignId) {
    try {
      console.log(`🚀 Processing campaign: ${campaignId}`);

      const campaign = await WhatsAppCampaign.findById(campaignId)
        .populate('whatsappAccount')
        .populate('user');

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const accountIdStr = campaign.whatsappAccount._id.toString();
      
      if (!this.isClientReady(accountIdStr)) {
        throw new Error('WhatsApp client not ready. Please reconnect.');
      }

      campaign.status = 'running';
      campaign.startedAt = new Date();
      await campaign.save();

      const { antiBlockSettings = {} } = campaign;
      const pendingMessages = campaign.messages.filter(m => m.status === 'pending');
      const batchSize = antiBlockSettings.maxMessagesPerBatch || 20;
      
      let totalSent = 0;
      let totalFailed = 0;

      for (let i = 0; i < pendingMessages.length; i += batchSize) {
        const batch = pendingMessages.slice(i, i + batchSize);
        
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pendingMessages.length/batchSize)}`);

        for (const [index, message] of batch.entries()) {
          try {
            if (!this.isClientReady(accountIdStr)) {
              throw new Error('Client disconnected during campaign');
            }

            let content = message.content;
            if (antiBlockSettings.contentVariation) {
              content = this.applyContentVariation(content);
            }

            const result = await this.sendMessage(
              accountIdStr,
              message.recipient.phone,
              content,
              {
                humanTyping: antiBlockSettings.humanTypingDelay,
                randomDelay: antiBlockSettings.randomDelay,
                minDelay: antiBlockSettings.messageDelay || 2000,
                maxDelay: (antiBlockSettings.messageDelay || 2000) * 2
              }
            );

            const whatsAppMessage = new WhatsAppMessage({
              user: campaign.user._id,
              campaign: campaign._id,
              whatsappAccount: campaign.whatsappAccount._id,
              recipient: message.recipient,
              content: content,
              status: result.success ? 'sent' : 'failed',
              messageId: result.messageId,
              sentAt: result.success ? new Date() : null,
              failureReason: result.success ? null : result.error
            });

            await whatsAppMessage.save();

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

            this.emitToUser(campaign.user._id, 'campaign_progress', {
              campaignId: campaign._id,
              progress: {
                total: campaign.messages.length,
                sent: totalSent,
                failed: totalFailed,
                pending: pendingMessages.length - totalSent - totalFailed
              }
            });

            if (index < batch.length - 1) {
              const delay = antiBlockSettings.messageDelay || 3000;
              await this.sleep(delay + Math.random() * delay);
            }

          } catch (error) {
            console.error(`Failed to send to ${message.recipient.phone}:`, error.message);
            
            message.status = 'failed';
            message.failureReason = error.message;
            totalFailed++;

            if (error.message.includes('Client disconnected') || 
                error.message.includes('not ready') ||
                error.message.includes('connection lost')) {
              break;
            }

            await this.sleep(2000);
          }
        }

        await campaign.save();

        if (i + batchSize < pendingMessages.length) {
          const batchDelay = antiBlockSettings.batchDelay || 60000;
          console.log(`⏳ Waiting ${batchDelay/1000}s before next batch...`);
          await this.sleep(batchDelay);
        }
      }

      campaign.status = totalFailed === 0 ? 'completed' : 'partial';
      campaign.completedAt = new Date();
      await campaign.save();

      this.emitToUser(campaign.user._id, 'campaign_completed', {
        campaignId: campaign._id,
        stats: { total: campaign.messages.length, sent: totalSent, failed: totalFailed }
      });

      return { success: true, stats: { sent: totalSent, failed: totalFailed } };

    } catch (error) {
      console.error('Campaign processing failed:', error);
      
      await WhatsAppCampaign.findByIdAndUpdate(campaignId, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date()
      });

      throw error;
    }
  }

  // Utility methods
  isClientReady(accountId) {
    const client = this.clients.get(accountId);
    const health = this.connectionHealth.get(accountId);
    return client && client.info && health?.status === 'ready';
  }

  emitToUser(userId, event, data, io = null) {
    const socketIo = io || global.io;
    if (socketIo) {
      socketIo.to(`user_${userId}`).emit(event, data);
    }
  }

  async handleMessageAck(msg, ack, accountId) {
    try {
      const message = await WhatsAppMessage.findOne({
        messageId: msg.id._serialized
      });

      if (!message) return;

      let status;
      let timestamp = new Date();

      switch (ack) {
        case 1:
          status = 'sent';
          message.sentAt = timestamp;
          break;
        case 2:
          status = 'delivered';
          message.deliveredAt = timestamp;
          break;
        case 3:
          status = 'read';
          message.readAt = timestamp;
          if (message.sentAt) {
            message.analytics = message.analytics || {};
            message.analytics.timeToRead = timestamp - message.sentAt;
          }
          break;
        default:
          return;
      }

      message.status = status;
      await message.save();

      if (message.campaign) {
        const campaign = await WhatsAppCampaign.findById(message.campaign);
        if (campaign) {
          const campaignMessage = campaign.messages.find(m => 
            m.messageId === msg.id._serialized
          );
          if (campaignMessage) {
            campaignMessage.status = status;
            if (status === 'delivered') campaignMessage.deliveredAt = timestamp;
            if (status === 'read') campaignMessage.readAt = timestamp;
            await campaign.save();
          }
        }
      }

      this.emitToUser(message.user, 'message_status_update', {
        messageId: message._id,
        status: status,
        timestamp: timestamp
      });

    } catch (error) {
      console.error('Error handling message ack:', error);
    }
  }

  // Helper methods
  simulateTyping(textLength) {
    const typingTime = Math.min(textLength * 30, 3000);
    return this.sleep(typingTime);
  }

  applyContentVariation(content) {
    if (content.type !== 'text') return content;
    
    const variations = [
      text => text,
      text => text + ' 😊',
      text => `Hi! ${text}`,
      text => text + '\n\nBest regards!',
      text => text.replace(/\./g, '...'),
      text => `Hello, ${text}`,
      text => text + ' 👍',
      text => text + '\n\nThank you!'
    ];
    
    const variation = variations[Math.floor(Math.random() * variations.length)];
    
    return {
      ...content,
      text: variation(content.text)
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API methods
  getQRCode(accountId) {
    return this.qrCodes.get(accountId);
  }

  getAccountStatus(accountId) {
    const health = this.connectionHealth.get(accountId);
    const client = this.clients.get(accountId);
    
    if (!client) return { status: 'disconnected' };
    if (!client.info) return { status: 'connecting' };
    
    return {
      status: health?.status === 'ready' ? 'ready' : 'connecting',
      phoneNumber: client.info.wid?.user,
      profileName: client.info.pushname
    };
  }

  getConnectedAccounts() {
    const connected = [];
    for (const [accountId, client] of this.clients.entries()) {
      if (client.info && this.connectionHealth.get(accountId)?.status === 'ready') {
        connected.push({
          accountId,
          phoneNumber: client.info.wid?.user,
          profileName: client.info.pushname
        });
      }
    }
    return connected;
  }

  // New method: Force reconnect for stuck clients
  async forceReconnect(accountId, userId, io = null) {
    const accountIdStr = accountId.toString();
    
    try {
      console.log(`🔄 Force reconnecting account: ${accountIdStr}`);
      
      // Stop any pending reconnection attempts
      this.reconnectAttempts.delete(accountIdStr);
      
      // Force cleanup everything
      await this.forceCleanupClient(accountIdStr);
      
      // Wait a bit
      await this.sleep(3000);
      
      // Initialize fresh client
      return await this.initializeClient(accountIdStr, userId, io);
      
    } catch (error) {
      console.error(`Force reconnect failed for ${accountIdStr}:`, error.message);
      throw error;
    }
  }

  // Graceful shutdown method
  async shutdown() {
    console.log('🛑 Shutting down WhatsApp Web Service...');
    
    const shutdownPromises = [];
    for (const [accountId, client] of this.clients.entries()) {
      shutdownPromises.push(this.safeCleanupClient(accountId));
    }
    
    try {
      await Promise.allSettled(shutdownPromises);
      console.log('✅ WhatsApp Web Service shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

module.exports = new WhatsAppWebService();