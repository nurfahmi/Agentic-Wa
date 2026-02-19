# Koperasi WhatsApp AI

WhatsApp AI Filtering System for Malaysian Government Koperasi.

## Prerequisites

- **Node.js** >= 18
- **MySQL** database
- **Redis** server

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/nurfahmi/Agentic-Wa.git
cd Agentic-Wa

# 2. Install dependencies
npm install

# 3. Copy environment file and configure
cp .env.example .env
# Edit .env with your database, Redis, OpenAI, and WABA credentials

# 4. Generate Prisma client
npx prisma generate

# 5. Build CSS
npm run build:css

# 6. Start the server
npm start
```

On first run, the server will:
1. **Auto-create all database tables** (via `prisma db push`)
2. **Print a one-time setup URL** in the console if no users exist

Example console output:
```
==============================================
  NO USERS FOUND — First-time setup required
  Setup URL: http://localhost:3003/auth/setup/<token>
==============================================
```

Open that URL to create your first **superadmin** account. The link expires once used.

## Development

```bash
npm run dev
```

This runs Tailwind CSS in watch mode and nodemon together.

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3003) |
| `NODE_ENV` | `development` or `production` |
| `JWT_SECRET` | Secret key for JWT tokens |
| `ENCRYPTION_KEY` | 32-char encryption key |
| `DATABASE_URL` | MySQL connection string |
| `REDIS_HOST` | Redis host |
| `REDIS_PORT` | Redis port |
| `REDIS_PASSWORD` | Redis password (optional) |
| `WABA_TOKEN` | WhatsApp Business API token |
| `WABA_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WABA_VERIFY_TOKEN` | Webhook verify token |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | OpenAI model (default: gpt-4o) |
| `SITE_NAME` | Display name for the app |

## Cloudflare Tunnel (HTTPS)

The app supports running behind Cloudflare Tunnel out of the box (`trust proxy` is enabled). Just point your tunnel to `http://localhost:3003`.
