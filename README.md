# @simplens/nodemailer-gmail

Gmail/SMTP email provider plugin for SimpleNS using Nodemailer.

## Installation

```bash
npm install @simplens/nodemailer-gmail
```

## Configuration

Add to your `simplens.config.yaml`:

```yaml
providers:
  - package: "@simplens/nodemailer-gmail"
    id: "gmail"
    credentials:
      EMAIL_HOST: "${EMAIL_HOST}"        # Optional, default: smtp.gmail.com
      EMAIL_PORT: "${EMAIL_PORT}"        # Optional, default: 587
      EMAIL_USER: "${EMAIL_USER}"        # Required: your Gmail address
      EMAIL_PASS: "${EMAIL_PASS}"        # Required: Gmail App Password
      EMAIL_FROM: "${EMAIL_FROM}"        # Optional, defaults to EMAIL_USER
    options:
      priority: 1
      rateLimit:
        maxTokens: 100     # Token bucket size
        refillRate: 10     # Tokens per second

channels:
  email:
    default: "gmail"
```

## Gmail App Password

For Gmail, you need to use an App Password, not your regular password:

1. Enable 2-Factor Authentication on your Google account
2. Go to: https://myaccount.google.com/apppasswords
3. Generate an app password for "Mail"
4. Use that password as `EMAIL_PASS`

## Environment Variables

```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=your-email@gmail.com
```

## Notification Format

```json
{
  "notification_id": "...",
  "request_id": "uuid-v4",
  "client_id": "uuid-v4",
  "channel": "email",
  "recipient": {
    "user_id": "user-123",
    "email": "recipient@example.com"
  },
  "content": {
    "subject": "Hello!",
    "message": "Hello {{name}}, welcome!"
  },
  "variables": {
    "name": "World"
  },
  "webhook_url": "https://your-app.com/webhook",
  "retry_count": 0,
  "created_at": "2024-01-01T00:00:00Z"
}
```

## Features

- ✅ HTML and plain text emails (auto-detected)
- ✅ Template variable substitution (`{{key}}`, `${key}`, `{key}`, `$key` syntax)
- ✅ Configurable rate limiting
- ✅ Automatic retry classification
- ✅ Gmail and any SMTP server support

## License

MIT
