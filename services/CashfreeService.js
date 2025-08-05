const axios = require('axios');
const crypto = require('crypto');

class CashfreeService {
  constructor() {
    this.appId = process.env.CASHFREE_CLIENT_ID;
    this.secretKey = process.env.CASHFREE_CLIENT_SECRET;
    this.environment = 'PROD';
    this.baseURL = 'https://api.cashfree.com/pg'
  }

  // Create payment order
  async createOrder(orderData) {
    try {
      const {
        order_id,
        order_amount,
        order_currency = 'INR',
        customer_details,
        order_meta
      } = orderData;

      const response = await axios.post(`${this.baseURL}/orders`, {
        order_id,
        order_amount,
        order_currency,
        customer_details,
        order_meta
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
}

module.exports = new CashfreeService();