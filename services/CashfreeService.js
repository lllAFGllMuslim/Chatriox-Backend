const axios = require('axios');
const crypto = require('crypto');

class CashfreeService {
  constructor() {
    this.appId = process.env.CASHFREE_APP_ID;
    this.secretKey = process.env.CASHFREE_SECRET_KEY;
    this.environment = process.env.CASHFREE_ENV || 'TEST';
    this.baseURL = this.environment === 'PROD' 
      ? 'https://api.cashfree.com/pg' 
      : 'https://sandbox.cashfree.com/pg';
  }

  // Generate signature for API authentication
  generateSignature(postData) {
    const signatureData = postData + this.secretKey;
    return crypto.createHash('sha256').update(signatureData).digest('base64');
  }

  // Create payment order
  async createOrder(orderData) {
    try {
      const {
        orderId,
        orderAmount,
        orderCurrency = 'INR',
        customerName,
        customerEmail,
        customerPhone,
        returnUrl,
        notifyUrl
      } = orderData;

      const postData = JSON.stringify({
        orderId,
        orderAmount,
        orderCurrency,
        customerName,
        customerEmail,
        customerPhone,
        returnUrl,
        notifyUrl
      });

      const signature = this.generateSignature(postData);

      const response = await axios.post(`${this.baseURL}/orders`, {
        orderId,
        orderAmount,
        orderCurrency,
        customerName,
        customerEmail,
        customerPhone,
        returnUrl,
        notifyUrl
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.appId,
          'x-client-secret': this.secretKey,
          'x-api-version': '2022-09-01'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Cashfree create order error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Get order status
  async getOrderStatus(orderId) {
    try {
      const response = await axios.get(`${this.baseURL}/orders/${orderId}`, {
        headers: {
          'x-client-id': this.appId,
          'x-client-secret': this.secretKey,
          'x-api-version': '2022-09-01'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Cashfree get order status error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Create subscription
  async createSubscription(subscriptionData) {
    try {
      const {
        subscriptionId,
        planId,
        customerName,
        customerEmail,
        customerPhone,
        amount,
        intervalType = 'month',
        intervals = 1
      } = subscriptionData;

      const response = await axios.post(`${this.baseURL}/subscriptions`, {
        subscriptionId,
        planId,
        customerName,
        customerEmail,
        customerPhone,
        amount,
        intervalType,
        intervals
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.appId,
          'x-client-secret': this.secretKey,
          'x-api-version': '2022-09-01'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Cashfree create subscription error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Cancel subscription
  async cancelSubscription(subscriptionId) {
    try {
      const response = await axios.post(`${this.baseURL}/subscriptions/${subscriptionId}/cancel`, {}, {
        headers: {
          'x-client-id': this.appId,
          'x-client-secret': this.secretKey,
          'x-api-version': '2022-09-01'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Cashfree cancel subscription error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Verify payment signature
  verifySignature(orderId, orderAmount, referenceId, txStatus, paymentMode, txMsg, txTime, signature) {
    const signatureData = `${orderId}${orderAmount}${referenceId}${txStatus}${paymentMode}${txMsg}${txTime}`;
    const computedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(signatureData)
      .digest('base64');
    
    return computedSignature === signature;
  }
}

module.exports = new CashfreeService();