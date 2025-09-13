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
    this.connectionStatus = new Map();
    this.initializingClients = new Set();
    
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

async initializeClient(accountId, userId, io = null) {
  const accountIdStr = accountId.toString();
  const initKey = `${userId}_${accountIdStr}`;
  
  if (this.initializingClients.has(initKey)) {
    console.log(`⚠️ Client initialization already in progress for: ${accountIdStr}`);
    throw new Error('Client initialization already in progress');
  }
  
  this.initializingClients.add(initKey);
  
  try {
    console.log(`🔄 Starting initialization for account: ${accountIdStr}`);

    const account = await WhatsAppAccount.findOne({ _id: accountIdStr, user: userId });
    if (!account) {
      throw new Error('Account not found');
    }

    console.log(`✅ Account found: ${account.accountName}, Status: ${account.status}`);

    // Force cleanup any existing client and session
    console.log(`🧹 Force cleaning up existing client and sessions...`);
    await this.forceCleanupClient(accountIdStr);
    await this.sleep(2000);

    // Update status to connecting
    await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
      status: 'connecting',
      errorMessage: null,
      qrCode: null,
      isConnected: false,
      updatedAt: new Date()
    });

    // Create session directory - FORCE NEW SESSION
    const sessionId = `wa_${userId}_${accountIdStr}_${Date.now()}`;
    const sessionDir = path.join(this.sessionPath, sessionId);
    
    console.log(`📁 Creating new session: ${sessionDir}`);
    
    // Ensure clean slate
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    // FIXED: Better client configuration
    console.log(`🔧 Creating WhatsApp client...`);
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: sessionId,
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
          '--single-process', // IMPORTANT: This often fixes initialization issues
          '--disable-gpu'
        ]
      },
      qrMaxRetries: 3, // Reduce retries to speed up process
      takeoverOnConflict: true // IMPORTANT: Take over existing sessions
    });

    console.log(`✅ WhatsApp client created with session: ${sessionId}`);

    this.clients.set(accountIdStr, client);
    this.connectionStatus.set(accountIdStr, { 
      status: 'initializing', 
      userId,
      sessionId 
    });

    // CRITICAL FIX: Setup events BEFORE initializing
    console.log(`📡 Setting up client events...`);
    this.setupClientEvents(client, accountIdStr, userId, io);

    // Emit initialization started
    this.emitToUser(userId, 'whatsapp_initializing', {
      accountId: accountIdStr,
      message: 'Starting WhatsApp client...',
      sessionId
    }, io);

    console.log(`🚀 Calling client.initialize()...`);
    
    // FIXED: Don't use Promise.race - just initialize and wait for events
    // The QR event will be handled by the event listeners we set up above
    try {
      await client.initialize();
      console.log(`✅ Client.initialize() completed for ${accountIdStr}`);
      
      // Wait a bit to see if QR or ready event fires
      await this.sleep(5000);
      
      const currentStatus = this.connectionStatus.get(accountIdStr);
      if (!currentStatus || currentStatus.status === 'initializing') {
        console.log(`⚠️ No status update after 5 seconds, client may be stuck`);
        
        // Try to trigger QR generation manually
        console.log(`🔄 Attempting to trigger QR generation manually...`);
        
        // Check if client is actually ready for QR
        try {
          const state = await client.getState();
          console.log(`📊 Client state: ${state}`);
          
          if (state === 'OPENING') {
            console.log(`⏳ Client is opening, waiting for QR...`);
            // Wait longer for QR
            await this.sleep(10000);
          }
          
        } catch (stateError) {
          console.log(`⚠️ Could not get client state: ${stateError.message}`);
        }
      }
      
      return client;

    } catch (initError) {
      console.error(`❌ Client.initialize() failed:`, initError.message);
      throw initError;
    }

  } catch (error) {
    console.error(`❌ Initialization failed for ${accountIdStr}:`, error.message);
    
    await this.cleanupClient(accountIdStr);
    
    await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
      status: 'disconnected',
      errorMessage: error.message,
      isConnected: false,
      qrCode: null,
      updatedAt: new Date()
    }).catch(console.error);

    this.emitToUser(userId, 'whatsapp_error', {
      accountId: accountIdStr,
      error: error.message,
      phase: 'initialization'
    }, io);

    throw error;
  } finally {
    this.initializingClients.delete(initKey);
  }
}
async forceGenerateQR(accountId, userId, io = null) {
  const accountIdStr = accountId.toString();
  console.log(`🔄 Force generating QR for account: ${accountIdStr}`);
  
  try {
    const client = this.clients.get(accountIdStr);
    if (!client) {
      throw new Error('Client not found');
    }
    
    // Destroy existing client and recreate
    console.log(`🧹 Destroying existing client...`);
    await client.destroy().catch(e => console.log(`Destroy error: ${e.message}`));
    
    this.clients.delete(accountIdStr);
    this.qrCodes.delete(accountIdStr);
    
    // Wait a bit
    await this.sleep(3000);
    
    // Reinitialize
    console.log(`🔄 Reinitializing client for QR...`);
    await this.initializeClient(accountIdStr, userId, io);
    
  } catch (error) {
    console.error(`❌ Force QR generation failed:`, error.message);
    throw error;
  }
}


  setupClientEvents(client, accountIdStr, userId, io) {
    console.log(`🔧 Setting up events for client ${accountIdStr}`);
    
    // QR Code event - SIMPLIFIED AND FIXED
client.on('qr', async (qr) => {
  try {
    console.log(`📱 ========== QR EVENT FINALLY TRIGGERED! ==========`);
    console.log(`Account: ${accountIdStr}, User: ${userId}`);
    console.log(`QR Length: ${qr ? qr.length : 'NULL'}`);
    console.log(`QR Preview: ${qr ? qr.substring(0, 50) + '...' : 'NO DATA'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`================================================`);
    
    if (!qr) {
      console.error(`❌ QR data is null!`);
      throw new Error('QR code data is null');
    }
    
    // Generate QR code image
    console.log(`🎨 Generating QR code image...`);
    const dataUrl = await QRCode.toDataURL(qr, {
      errorCorrectionLevel: 'M',
      width: 400,
      margin: 2
    });
    
    console.log(`✅ QR image generated! Size: ${dataUrl.length} characters`);
    
    // Store QR code
    this.qrCodes.set(accountIdStr, dataUrl);
    
    // Update database
    await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
      qrCode: dataUrl,
      status: 'qr_ready',
      errorMessage: null,
      updatedAt: new Date()
    }).catch(console.error);

    // Prepare QR data
    const qrData = {
      accountId: accountIdStr,
      qrCode: dataUrl,
      status: 'qr_ready',
      timestamp: new Date().toISOString()
    };
    
    console.log(`📡 ========== EMITTING QR CODE ==========`);
    console.log(`Emitting to user: ${userId}`);
    
    // Multiple emission strategy
    const events = ['qr_code', 'whatsapp_qr', 'qr_generated', 'qr_ready'];
    events.forEach((eventName, index) => {
      setTimeout(() => {
        this.emitToUser(userId, eventName, qrData, io);
        console.log(`📡 Emitted: ${eventName}`);
      }, index * 200);
    });
    
    console.log(`✅ QR CODE EMISSION COMPLETED`);
    
  } catch (error) {
    console.error(`❌ QR event error:`, error.message);
    console.error(`❌ Stack trace:`, error.stack);
    
    // Emit error
    this.emitToUser(userId, 'qr_error', {
      accountId: accountIdStr,
      error: error.message,
      timestamp: new Date().toISOString()
    }, io);
  }
});


    // Authentication success
    client.on('authenticated', async () => {
      console.log(`✅ AUTHENTICATED EVENT for: ${accountIdStr}`);
      
      this.connectionStatus.set(accountIdStr, { 
        status: 'authenticated', 
        userId,
        lastCheck: Date.now()
      });
      
      // Clear QR code after authentication
      this.qrCodes.delete(accountIdStr);
      
      await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
        status: 'authenticated',
        qrCode: null,
        errorMessage: null,
        updatedAt: new Date()
      }).catch(console.error);
      
      this.emitToUser(userId, 'whatsapp_authenticated', { 
        accountId: accountIdStr,
        timestamp: new Date().toISOString()
      }, io);
    });

    // Client ready
    client.on('ready', async () => {
      console.log(`✅ CLIENT READY: ${accountIdStr}`);
      
      try {
        const phoneNumber = client.info?.wid?.user;
        const profileName = client.info?.pushname || 'Unknown';
        
        console.log(`📱 Phone: ${phoneNumber}, Profile: ${profileName}`);
        
        this.connectionStatus.set(accountIdStr, { 
          status: 'ready', 
          userId,
          phoneNumber,
          profileName,
          lastCheck: Date.now()
        });

        // Clear QR code
        this.qrCodes.delete(accountIdStr);

        await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
          status: 'ready',
          isConnected: true,
          phoneNumber,
          profileName,
          lastActivity: new Date(),
          errorMessage: null,
          qrCode: null
        });
        
        this.emitToUser(userId, 'whatsapp_ready', {
          accountId: accountIdStr,
          phoneNumber,
          profileName,
          isConnected: true,
          timestamp: new Date().toISOString()
        }, io);
        
        console.log(`🎉 Account ${accountIdStr} is fully ready!`);
        
      } catch (error) {
        console.error(`❌ Error in ready handler:`, error);
      }
    });

    // Loading screen updates
    client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading ${accountIdStr}: ${percent}% - ${message}`);
      
      this.emitToUser(userId, 'whatsapp_loading', {
        accountId: accountIdStr,
        percent,
        message,
        timestamp: new Date().toISOString()
      }, io);
    });

    // Disconnection handling
    client.on('disconnected', async (reason) => {
      console.log(`❌ Disconnected ${accountIdStr}: ${reason}`);
      
      this.connectionStatus.set(accountIdStr, { 
        status: 'disconnected', 
        reason,
        lastCheck: Date.now()
      });

      // Clear QR code
      this.qrCodes.delete(accountIdStr);

      await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
        status: 'disconnected',
        isConnected: false,
        errorMessage: `Disconnected: ${reason}`,
        qrCode: null,
        updatedAt: new Date()
      }).catch(console.error);

      this.emitToUser(userId, 'whatsapp_disconnected', {
        accountId: accountIdStr,
        reason,
        timestamp: new Date().toISOString()
      }, io);

      // Cleanup after disconnect
      setTimeout(() => this.cleanupClient(accountIdStr), 5000);
    });

    // Authentication failure
    client.on('auth_failure', async (error) => {
      console.log(`❌ Auth failure ${accountIdStr}:`, error);
      
      // Clear QR code
      this.qrCodes.delete(accountIdStr);

      await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
        status: 'disconnected',
        isConnected: false,
        errorMessage: 'Authentication failed - please scan QR code again',
        qrCode: null,
        updatedAt: new Date()
      }).catch(console.error);

      this.emitToUser(userId, 'whatsapp_auth_failed', {
        accountId: accountIdStr,
        error: error.toString(),
        timestamp: new Date().toISOString()
      }, io);

      // Cleanup after auth failure
      setTimeout(() => this.cleanupClient(accountIdStr), 3000);
    });

    // State changes
    client.on('change_state', (state) => {
      console.log(`🔄 State change for ${accountIdStr}: ${state}`);
      
      this.emitToUser(userId, 'whatsapp_state_change', {
        accountId: accountIdStr,
        state,
        timestamp: new Date().toISOString()
      }, io);
    });

    console.log(`✅ All event handlers setup for ${accountIdStr}`);
  }

  // FIXED: Enhanced emit method
  emitToUser(userId, event, data, io = null) {
  try {
    const socketIo = io || global.io;
    if (!socketIo) {
      console.warn(`⚠️ Socket.IO instance not available for event: ${event}`);
      return false;
    }

    const userRoom = `user_${userId}`;
    
    // Enhanced logging for QR events
    if (event.includes('qr') || event.includes('QR')) {
      console.log(`📡 ========== EMITTING QR EVENT: ${event} ==========`);
      console.log(`User ID: ${userId}`);
      console.log(`User Room: ${userRoom}`);
      console.log(`Account ID: ${data.accountId || 'N/A'}`);
      console.log(`Data Keys: ${Object.keys(data).join(', ')}`);
      console.log(`QR Data Present: ${data.qrCode ? 'YES (' + data.qrCode.length + ' chars)' : 'NO'}`);
    }
    
    // Check room existence and socket count
    const rooms = socketIo.sockets.adapter.rooms;
    const room = rooms.get(userRoom);
    const socketCount = room ? room.size : 0;
    
    console.log(`🔍 Room '${userRoom}' has ${socketCount} connected socket(s)`);
    
    if (socketCount === 0) {
      console.warn(`⚠️ No sockets connected to room '${userRoom}' - event will not be delivered`);
      
      // Try broadcasting to all sockets for this user (fallback)
      let fallbackCount = 0;
      socketIo.sockets.sockets.forEach((socket) => {
        if (socket.userId === userId) {
          socket.emit(event, { ...data, timestamp: new Date().toISOString() });
          fallbackCount++;
        }
      });
      
      if (fallbackCount > 0) {
        console.log(`📡 Fallback: Emitted to ${fallbackCount} socket(s) directly`);
        return true;
      }
      
      return false;
    }
    
    // Emit to room
    const eventData = {
      ...data,
      timestamp: new Date().toISOString(),
      eventId: `${event}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    socketIo.to(userRoom).emit(event, eventData);
    
    if (event.includes('qr')) {
      console.log(`✅ QR event '${event}' emitted to ${socketCount} socket(s) in room '${userRoom}'`);
      console.log(`📦 Event data size: ${JSON.stringify(eventData).length} characters`);
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ EmitToUser error for event '${event}':`, error.message);
    console.error(`❌ Error details:`, {
      userId,
      event,
      dataKeys: Object.keys(data || {}),
      errorStack: error.stack?.split('\n')[0]
    });
    return false;
  }
}


  async sendMessage(accountId, recipient, content, options = {}) {
    const accountIdStr = accountId.toString();
    
    try {
      const client = this.clients.get(accountIdStr);
      if (!client || !client.info) {
        throw new Error('WhatsApp client not ready');
      }

      const state = await client.getState();
      if (state !== 'CONNECTED') {
        throw new Error(`WhatsApp not connected: ${state}`);
      }

      let phoneNumber = recipient.replace(/\D/g, '');
      if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
        phoneNumber = '91' + phoneNumber;
      }

      const chatId = `${phoneNumber}@c.us`;
      const numberId = await client.getNumberId(chatId);
      
      if (!numberId) {
        throw new Error(`Number not on WhatsApp: ${phoneNumber}`);
      }

      if (options.randomDelay) {
        const delay = Math.random() * 3000 + 1000;
        await this.sleep(delay);
      }

      let message;
      switch (content.type) {
        case 'text':
          message = await client.sendMessage(chatId, content.text);
          break;
          
        case 'image':
          const imageMedia = content.mediaPath ? 
            MessageMedia.fromFilePath(content.mediaPath) :
            await MessageMedia.fromUrl(content.mediaUrl);
          message = await client.sendMessage(chatId, imageMedia, { 
            caption: content.caption || '' 
          });
          break;
          
        default:
          throw new Error('Unsupported message type');
      }

      await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
        $inc: { dailyMessageCount: 1 },
        lastActivity: new Date()
      }).catch(console.error);

      return {
        success: true,
        messageId: message.id._serialized,
        timestamp: new Date()
      };

    } catch (error) {
      console.error(`Send failed ${accountIdStr}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async disconnectAccount(accountId, userId = null, io = null) {
    const accountIdStr = accountId.toString();
    
    try {
      console.log(`🔌 Disconnecting account: ${accountIdStr}`);
      
      const client = this.clients.get(accountIdStr);
      let loggedOut = false;

      if (client && client.info) {
        try {
          await Promise.race([
            client.logout().then(() => { loggedOut = true; }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Logout timeout')), 10000)
            )
          ]);
        } catch (logoutError) {
          console.error('❌ Logout failed:', logoutError.message);
        }
      }

      await this.forceCleanupClient(accountIdStr);

      await WhatsAppAccount.findByIdAndUpdate(accountIdStr, {
        status: 'disconnected',
        isConnected: false,
        phoneNumber: null,
        qrCode: null,
        errorMessage: loggedOut ? 'Logged out successfully' : 'Disconnected locally',
        updatedAt: new Date()
      }).catch(console.error);

      if (userId && io) {
        this.emitToUser(userId, 'whatsapp_disconnected', {
          accountId: accountIdStr,
          reason: 'Manual disconnect',
          properLogout: loggedOut,
          timestamp: new Date().toISOString()
        }, io);
      }

      return { 
        success: true, 
        properLogout: loggedOut
      };

    } catch (error) {
      console.error(`❌ Disconnect failed ${accountIdStr}:`, error.message);
      throw error;
    }
  }

  async cleanupClient(accountId) {
    const accountIdStr = accountId.toString();
    
    try {
      console.log(`🧹 Cleaning up client: ${accountIdStr}`);
      
      const client = this.clients.get(accountIdStr);
      if (client) {
        try {
          await Promise.race([
            client.destroy(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Destroy timeout')), 10000)
            )
          ]);
          console.log(`✅ Client destroyed: ${accountIdStr}`);
        } catch (destroyError) {
          console.error(`❌ Client destroy error: ${destroyError.message}`);
        }
        this.clients.delete(accountIdStr);
      }
      
      this.qrCodes.delete(accountIdStr);
      this.connectionStatus.delete(accountIdStr);
      
      console.log(`✅ Cleanup completed: ${accountIdStr}`);
      
    } catch (error) {
      console.error(`❌ Cleanup error ${accountIdStr}:`, error.message);
    }
  }

  async forceCleanupClient(accountId) {
    const accountIdStr = accountId.toString();
    
    await this.cleanupClient(accountIdStr);
    
    // Remove session files
    try {
      const sessionFiles = fs.readdirSync(this.sessionPath);
      
      for (const file of sessionFiles) {
        if (file.includes(`_${accountIdStr}`) || 
            file.includes(`session-${accountIdStr}`) ||
            file.includes(`wa_`) && file.includes(`_${accountIdStr}_`)) {
          const fullPath = path.join(this.sessionPath, file);
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`🗑️ Removed session: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Session cleanup error: ${error.message}`);
    }
  }

  isClientReady(accountId) {
    const client = this.clients.get(accountId);
    const status = this.connectionStatus.get(accountId);
    return client && client.info && status?.status === 'ready';
  }

  getQRCode(accountId) {
  const accountIdStr = accountId.toString();
  const qrData = this.qrCodes.get(accountIdStr);
  
  console.log(`🔍 QR retrieval for ${accountIdStr}:`);
  console.log(`  - QR exists: ${qrData ? 'YES' : 'NO'}`);
  console.log(`  - QR size: ${qrData ? qrData.length + ' chars' : 'N/A'}`);
  console.log(`  - Valid format: ${qrData && qrData.startsWith('data:image/') ? 'YES' : 'NO'}`);
  
  // Validate QR data before returning
  if (qrData && !qrData.startsWith('data:image/')) {
    console.warn(`⚠️ Invalid QR format detected for ${accountIdStr}, removing...`);
    this.qrCodes.delete(accountIdStr);
    return null;
  }
  
  return qrData;
}
cleanupExpiredQRCodes() {
  const now = Date.now();
  const expiredAccounts = [];
  
  this.qrCodes.forEach((qrData, accountId) => {
    // QR codes older than 2 minutes are considered expired
    const qrAge = now - this.connectionStatus.get(accountId)?.qrGeneratedAt;
    if (qrAge > 120000) {
      expiredAccounts.push(accountId);
    }
  });
  
  expiredAccounts.forEach(accountId => {
    console.log(`🧹 Cleaning expired QR for account: ${accountId}`);
    this.qrCodes.delete(accountId);
  });
  
  return expiredAccounts.length;
}


  getAccountStatus(accountId) {
    const status = this.connectionStatus.get(accountId);
    const client = this.clients.get(accountId);
    
    if (!client) return { status: 'disconnected' };
    if (!client.info) return { status: 'connecting' };
    
    return {
      status: status?.status || 'connecting',
      phoneNumber: client.info.wid?.user,
      profileName: client.info.pushname
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown() {
    console.log('🛑 Shutting down WhatsApp service...');
    
    const cleanupPromises = Array.from(this.clients.keys())
      .map(accountId => this.cleanupClient(accountId));
    
    await Promise.allSettled(cleanupPromises);
    console.log('✅ Shutdown complete');
  }
}

module.exports = new WhatsAppWebService();