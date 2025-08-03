# Marketing Dashboard Backend

A comprehensive Node.js backend API for the Marketing Dashboard application with MongoDB database.

## Features

- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Email Marketing**: Send campaigns via SMTP, Gmail API integration
- **WhatsApp Integration**: Send messages via WhatsApp Business API
- **Email Validation**: Validate email addresses with detailed scoring
- **Web Scraping**: Extract email addresses from websites
- **Account Management**: Manage email accounts and API keys
- **Plans & Billing**: Subscription management with usage tracking
- **Settings**: User preferences, notifications, and profile management
- **Dashboard Analytics**: Real-time statistics and charts data

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: Express Validator
- **Security**: Helmet, CORS, Rate Limiting
- **File Upload**: Multer
- **Email**: Nodemailer
- **Web Scraping**: Cheerio, Axios

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Setup**
```bash
cp .env.example .env
```

4. **Configure environment variables**
Edit `.env` file with your configuration:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/marketing_dashboard
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRE=7d

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Gmail API
GMAIL_CLIENT_ID=your_gmail_client_id
GMAIL_CLIENT_SECRET=your_gmail_client_secret

# WhatsApp API
WHATSAPP_API_URL=https://graph.facebook.com/v17.0
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token

# SendGrid API
SENDGRID_API_KEY=your_sendgrid_api_key
```

5. **Start MongoDB**
Make sure MongoDB is running on your system.

6. **Run the application**
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/forgot-password` - Password reset

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/dashboard/analytics` - Get analytics data for charts
- `GET /api/dashboard/campaigns` - Get top performing campaigns

### Email Marketing
- `POST /api/email/send` - Send email campaign
- `GET /api/email/campaigns` - Get user's campaigns
- `GET /api/email/campaigns/:id` - Get campaign details
- `DELETE /api/email/campaigns/:id` - Delete campaign

### Gmail Integration
- `POST /api/gmail/connect` - Connect Gmail account
- `POST /api/gmail/disconnect` - Disconnect Gmail account
- `POST /api/gmail/send` - Send email via Gmail
- `GET /api/gmail/accounts` - Get connected Gmail accounts
- `GET /api/gmail/quota/:email` - Get Gmail account quota

### WhatsApp
- `POST /api/whatsapp/send` - Send WhatsApp message
- `POST /api/whatsapp/bulk-send` - Send bulk WhatsApp messages
- `GET /api/whatsapp/campaigns` - Get WhatsApp campaigns
- `GET /api/whatsapp/templates` - Get message templates
- `GET /api/whatsapp/stats` - Get WhatsApp statistics

### Email Validation
- `POST /api/validation/single` - Validate single email
- `POST /api/validation/bulk` - Validate multiple emails
- `GET /api/validation/history` - Get validation history
- `GET /api/validation/stats` - Get validation statistics

### Web Scraping
- `POST /api/scraper/start` - Start scraping job
- `GET /api/scraper/jobs` - Get scraping jobs
- `GET /api/scraper/jobs/:id` - Get job details
- `POST /api/scraper/jobs/:id/cancel` - Cancel scraping job
- `GET /api/scraper/jobs/:id/results` - Get scraping results
- `GET /api/scraper/stats` - Get scraping statistics

### Account Management
- `GET /api/accounts/email-accounts` - Get email accounts
- `POST /api/accounts/email-accounts` - Add email account
- `PUT /api/accounts/email-accounts/:id` - Update email account
- `DELETE /api/accounts/email-accounts/:id` - Remove email account
- `GET /api/accounts/api-keys` - Get API keys
- `POST /api/accounts/api-keys` - Add API key
- `PUT /api/accounts/api-keys/:id` - Update API key
- `DELETE /api/accounts/api-keys/:id` - Remove API key
- `POST /api/accounts/api-keys/:id/test` - Test API key

### Plans & Billing
- `GET /api/plans` - Get all plans
- `GET /api/plans/current` - Get current user's plan
- `POST /api/plans/upgrade` - Upgrade plan
- `POST /api/plans/downgrade` - Downgrade plan
- `GET /api/plans/usage` - Get plan usage
- `POST /api/plans/cancel` - Cancel subscription

### Settings
- `GET /api/settings` - Get user settings
- `PUT /api/settings/profile` - Update profile
- `PUT /api/settings/password` - Change password
- `PUT /api/settings/preferences` - Update preferences
- `PUT /api/settings/notifications` - Update notifications
- `DELETE /api/settings/account` - Delete account
- `GET /api/settings/export` - Export user data

### User Management (Admin)
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id/status` - Update user status
- `PUT /api/users/:id/plan` - Update user plan
- `DELETE /api/users/:id` - Delete user
- `GET /api/users/stats/overview` - Get user statistics

## Database Models

### User Model
- Profile information (name, email, password)
- Plan and subscription details
- Settings and preferences
- Email accounts and API keys
- Usage statistics

### Campaign Model
- Campaign details (name, type, content)
- Recipients and their status
- Campaign statistics and performance
- Scheduling information

### EmailValidation Model
- Email validation results
- Validation score and details
- Validation timestamp

### ScrapingJob Model
- Scraping job configuration
- Progress tracking
- Results and statistics

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: Bcrypt for password security
- **Rate Limiting**: Prevent API abuse
- **CORS Protection**: Cross-origin request security
- **Helmet**: Security headers
- **Input Validation**: Comprehensive request validation
- **Role-based Access**: Admin and user roles
- **Plan-based Features**: Feature access based on subscription

## Error Handling

The API uses consistent error response format:
```json
{
  "success": false,
  "message": "Error description",
  "errors": [] // Validation errors if applicable
}
```

## Success Response Format

```json
{
  "success": true,
  "message": "Success message",
  "data": {} // Response data
}
```

## Development

### Running Tests
```bash
npm test
```

### Code Structure
```
backend/
├── models/          # Database models
├── routes/          # API routes
├── middleware/      # Custom middleware
├── utils/           # Utility functions
├── config/          # Configuration files
├── uploads/         # File uploads directory
└── server.js        # Main server file
```

### Adding New Features

1. Create model in `models/` directory
2. Add routes in `routes/` directory
3. Add middleware if needed
4. Update documentation

## Production Deployment

1. **Environment Variables**: Set all required environment variables
2. **Database**: Use MongoDB Atlas or dedicated MongoDB instance
3. **Process Manager**: Use PM2 for process management
4. **Reverse Proxy**: Use Nginx for reverse proxy
5. **SSL**: Enable HTTPS with SSL certificates
6. **Monitoring**: Set up logging and monitoring

## API Rate Limits

- **General API**: 100 requests per 15 minutes per IP
- **Authentication**: 5 login attempts per 15 minutes per IP
- **Email Sending**: Based on user's plan limits
- **Validation**: Based on user's plan limits

## Support

For support and questions, please contact the development team or create an issue in the repository.