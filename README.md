# NanoGPT Discord Bot

A Discord chatbot powered by NanoGPT API (subscription models only)

## Features

- Chat with AI models via slash commands
- Support for custom system prompts (via environment variable)
- Document context support (PDF, TXT, MD, and more)
- Per-user and per-server model preferences
- AI image generation with multiple models

## Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Go to "OAuth2" > "URL Generator"
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Use Slash Commands`, `Embed Links`, `Attach Files`
6. Use the generated URL to invite the bot to your server

### 2. Get NanoGPT API Key

1. Sign up at [NanoGPT](https://nano-gpt.com)
2. Subscribe to a plan
3. Go to settings and generate an API key

### 3. Configure Environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
NANOGPT_API_KEY=your_nanogpt_api_key
SYSTEM_PROMPT=
DEFAULT_MODEL=zai-org/glm-4.6v
```

### 4. Deploy with Docker Compose

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f bot

# Register slash commands (first time only)
docker compose exec bot bun run register
```

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands and how to use them |
| `/chat <message>` | Chat with the AI (stateless) |
| `/memory chat <message>` | Chat with AI that remembers your conversation |
| `/memory view` | View recent conversation history |
| `/memory stats` | Show your memory statistics |
| `/memory clear` | Clear your conversation memory |
| `/imagine <prompt>` | Generate an image from a text prompt |
| `/scrape <url>` | Scrape content from web pages |
| `/models` | List all available subscription models |
| `/setmodel <model>` | Set your default model (personal or server-wide) |
| `/usage` | Check your NanoGPT API usage statistics |
| `/context add <file> <name>` | Upload a document as reusable context |
| `/context list` | List all saved contexts |
| `/context view <name>` | View content of a saved context |
| `/context remove <name>` | Remove a saved context |

### /chat Options

| Option | Description |
|--------|-------------|
| `message` | (required) Your message to the AI |
| `context` | Name of a saved context to include |
| `model` | Override the default model for this message |
| `websearch` | Enable web search for real-time info ($0.006/request) |
| `deepsearch` | Enable deep web search for comprehensive info ($0.06/request) |
| `image` | Attach an image to analyze (png, jpg, jpeg, webp) |

### /context Scopes

Contexts can be personal or shared with the server:
- `scope:user` (default) - Personal context, only you can access
- `scope:server` - Shared context, available to all server members

### /imagine Options

| Option | Description |
|--------|-------------|
| `prompt` | (required) Text description of the image |
| `model` | Image model to use (autocomplete available) |
| `size` | Image size: 256x256, 512x512, or 1024x1024 |
| `guidance` | How closely to follow the prompt (0-20) |
| `steps` | Denoising steps (1-100) |
| `seed` | Random seed for reproducible results |
| `image` | Input image for img2img transformation |
| `strength` | Img2img strength (0-1) |

### /scrape Options

| Option | Description |
|--------|-------------|
| `url` | (required) URL to scrape |
| `url2` - `url5` | Additional URLs (up to 5 total) |
| `stealth` | Use stealth mode for tougher targets (5x cost, $0.005/URL) |
| `download` | Attach results as .md file(s) |

## Feature Toggles

Control feature availability via environment variables:

| Value | Effect |
|-------|--------|
| `false` | Feature enabled for everyone (default) |
| `true` | Feature disabled for everyone |
| `admin` | Feature only available to admin users (see `CONTEXT_ADMIN_USERS`) |

Available toggles: `DISABLE_WEBSEARCH`, `DISABLE_DEEPSEARCH`, `DISABLE_IMAGEGEN`, `DISABLE_SCRAPE`

## Document Support

The bot can process the following file types as context:

- PDF (`.pdf`)
- Plain text (`.txt`, `.text`)
- Markdown (`.md`, `.markdown`)
- Log files (`.log`)
- JSON (`.json`)
- XML (`.xml`)
- CSV (`.csv`)
- HTML (`.html`, `.htm`)