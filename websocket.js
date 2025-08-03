const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

class WebSocketService {
  constructor(server) {
    this.io = socketIo(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? ['https://yourdomain.com'] 
          : ['http://localhost:3000', 'http://localhost:5173'],
        credentials: true
      }
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    // Make io globally available
    global.io = this.io;
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication error'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user) {
          return next(new Error('User not found'));
        }

        socket.userId = user._id.toString();
        socket.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication error'));
      }
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User ${socket.userId} connected`);
      
      // Join user-specific room
      socket.join(`user_${socket.userId}`);

      // Handle WhatsApp account events
      socket.on('whatsapp_connect', async (data) => {
        try {
          const { accountId } = data;
          // Initialize WhatsApp connection
          const WhatsAppService = require('./services/WhatsAppService');
          await WhatsAppService.initializeClient(accountId, socket.userId);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      socket.on('whatsapp_disconnect', async (data) => {
        try {
          const { accountId } = data;
          const WhatsAppService = require('./services/WhatsAppService');
          await WhatsAppService.disconnectAccount(accountId);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle campaign events
      socket.on('campaign_start', async (data) => {
        try {
          const { campaignId } = data;
          const WhatsAppService = require('./services/WhatsAppService');
          await WhatsAppService.processCampaign(campaignId);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      socket.on('campaign_pause', async (data) => {
        try {
          const { campaignId } = data;
          const WhatsAppCampaign = require('./models/WhatsAppCampaign');
          await WhatsAppCampaign.findByIdAndUpdate(campaignId, { status: 'paused' });
          socket.emit('campaign_paused', { campaignId });
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle real-time analytics requests
      socket.on('subscribe_analytics', (data) => {
        const { campaignId } = data;
        socket.join(`campaign_${campaignId}`);
      });

      socket.on('unsubscribe_analytics', (data) => {
        const { campaignId } = data;
        socket.leave(`campaign_${campaignId}`);
      });

      socket.on('disconnect', () => {
        console.log(`User ${socket.userId} disconnected`);
      });
    });
  }

  // Emit campaign progress updates
  emitCampaignProgress(campaignId, progress) {
    this.io.to(`campaign_${campaignId}`).emit('campaign_progress', {
      campaignId,
      progress
    });
  }

  // Emit message status updates
  emitMessageStatus(campaignId, messageId, status) {
    this.io.to(`campaign_${campaignId}`).emit('message_status', {
      campaignId,
      messageId,
      status
    });
  }

  // Emit WhatsApp account status updates
  emitAccountStatus(userId, accountId, status) {
    this.io.to(`user_${userId}`).emit('account_status', {
      accountId,
      status
    });
  }
}

module.exports = WebSocketService;