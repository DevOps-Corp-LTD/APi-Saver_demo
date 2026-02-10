# APi-Saver - Demo Version

> **⚠️ DEMO VERSION**: This demo is limited to **2 API sources**. For unlimited sources and enterprise features, contact **services@devops-corp.com**.

**APi-Saver** is an enterprise API caching and proxy solution that helps you:
- ✅ Secure API keys (never expose them in client apps)
- ✅ Cache API responses automatically
- ✅ Handle rate limiting and retries
- ✅ Monitor API usage and performance

## 🎯 Demo Limitations

- **Maximum 2 API sources** (full version: unlimited)
- Contact **services@devops-corp.com** for full version pricing

## ✨ Key Features

- 🔐 **Secure API Key Management** - Store API keys server-side, never expose them
- ⚡ **Smart Caching** - Automatic response caching with configurable TTL
- 🛡️ **Rate Limiting** - Protect your APIs from abuse
- 👥 **User Management** - Admin and Viewer roles with JWT authentication
- 📊 **Monitoring** - Track cache hits, API usage, and performance metrics
- 🔄 **Multi-Source Support** - Configure up to 2 sources with failover (demo limit)

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Prerequisites
- **Docker** & **Docker Compose** installed ([Download Docker](https://www.docker.com/get-started))
- **Git** (optional - only if cloning from repository)

### Step 2: Setup

```bash
# If you haven't already, clone the repository
git clone https://github.com/yotamkrief/APi-Saver_demo.git
cd APi-Saver_demo

# Copy environment file (no editing needed for demo!)
cp env.example .env

# Start APi-Saver
docker compose up -d --build

#(If using owndomain) Run the initial certificate step once (e.g. init-ssl.sh) with DOMAIN and EMAIL set (e.g. from .env).
set -a; source .env; set +a; ./scripts/init-ssl.sh

# Setup database
docker compose exec backend npm run migrate
docker compose exec backend npm run seed

#💡 The seed script displays your API key in the console output - save it! You'll need it for API calls and authentication.



```
### Step 3: Access

1. **Open your browser**: http://localhost
2. **Login**: Use the API key shown in the seed output.
3. **Add your first API source** in the dashboard ( 2 sources in demo version pre-installed)

**That's it!** You're ready to use APi-Saver.


**Need to see your API key again?**
```bash
docker compose logs backend | grep "api_key"
```

## 📖 How It Works

### The Problem
Your API keys are exposed in client-side code, making them vulnerable to theft and abuse.

### The Solution
APi-Saver acts as a secure proxy that:
- 🔐 **Hides your API keys** - Store them server-side, never expose them
- ⚡ **Caches responses** - Faster responses, fewer API calls
- 🛡️ **Rate limits** - Protects your APIs from abuse
- 🔄 **Handles errors** - Automatic retries and circuit breakers

### Example

**Before (unsafe):**
```javascript
// ❌ API key visible in browser/client code
const response = await fetch('https://api.example.com/data', {
  headers: { 'Authorization': 'Bearer YOUR_SECRET_KEY' }
});
```

**After (secure):**
```javascript
// ✅ Only APi-Saver key needed (safe to expose)
const response = await fetch('http://localhost/api/v1/proxy/my-source/data', {
  headers: { 'X-API-Key': 'ask_xxxxxxxxxxxx' }
});
```

### Using the Proxy Endpoint

**Format**: `/api/v1/proxy/{source-name}/{api-path}`

**Example**:
```bash
# If your source is named "weather-api" and you want to call /forecast
curl http://localhost/api/v1/proxy/weather-api/forecast \
  -H "X-API-Key: ask_xxxxxxxxxxxx"
```

APi-Saver automatically:
- Adds your stored API keys to the request
- Caches responses based on your cache policy
- Enforces rate limits
- Handles errors gracefully

## 👤 User Roles

- **Admin**: Full access - manage sources, users, cache, settings
- **Viewer**: Read-only - view sources, cache, and metrics

**Login**: Use the API key from seed output, or create users via the dashboard.

## ⚙️ Configuration (Dashboard)

All configuration is done through the web UI:

- **Sources**: Add up to 2 API sources (demo limit)
- **Cache Policies**: Set TTL and caching rules per source
- **Rate Limits**: Configure per-source or app-wide limits
- **Users**: Create admin/viewer accounts

No need to edit config files - everything is in the dashboard!

## 🔧 Common Commands

```bash
# View logs
docker compose logs -f backend

# Restart services
docker compose restart

# Backup database (demo)
docker compose exec postgres pg_dump -U apisaver apisaver > backup.sql

# Reset everything (deletes all data!)
docker compose down -v
docker compose up -d --build
docker compose exec backend npm run migrate
docker compose exec backend npm run seed
```

## 📡 API Usage

**Authentication**: Add header `X-API-Key: ask_xxxxxxxxxxxx`

**Main Endpoint** (recommended):
```bash
# Proxy through APi-Saver
GET /api/v1/proxy/{source-name}/{api-path}
```

**Example**:
```bash
curl http://localhost/api/v1/proxy/my-api/data \
  -H "X-API-Key: ask_xxxxxxxxxxxx"
```

**Other endpoints**: Use the web dashboard - it's easier! All API endpoints are available via the UI.

## ⚙️ Configuration

**For Demo**: The default `.env` file (copied from `env.example`) works out of the box! No changes needed.
See `env.example` for all available options and detailed comments.

## 🧪 Testing Your Setup

```bash
# 1. Health check
curl http://localhost/health

# 2. List sources (replace YOUR_API_KEY)
curl http://localhost/api/v1/sources \
  -H "X-API-Key: YOUR_API_KEY"

# 3. Test proxy endpoint
curl http://localhost/api/v1/proxy/your-source-name/path \
  -H "X-API-Key: YOUR_API_KEY"
```

---


## 🔒 Security

- API keys stored encrypted in database
- SSRF protection built-in
- Rate limiting enabled
- Input validation on all endpoints
- Audit logging for admin actions

**For production**: Always use HTTPS and strong secrets!

## 💬 Support

For questions or to purchase the full version, contact **services@devops-corp.com**








