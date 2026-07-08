# CloneGuard Discord Bot

A Discord bot that automatically bans clone/bot accounts from your server when they join, based on a multi-signal suspicion scoring system.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the bot + API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages

## Required Secrets

| Secret | Description |
|--------|-------------|
| `DISCORD_BOT_TOKEN` | Your bot token from the Discord Developer Portal |

## Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_LOG_CHANNEL_ID` | (none) | Channel ID where the bot posts ban/flag embeds |
| `BAN_SCORE_THRESHOLD` | `5` | Suspicion score at which a member is banned |
| `FLAG_SCORE_THRESHOLD` | `3` | Suspicion score at which a member is flagged in logs |
| `BOT_STATUS_TOKEN` | (none) | Bearer token to enable the `/api/bot/status` endpoint |

## Detection Signals

| Signal | Score |
|--------|-------|
| No custom avatar | +3 |
| Username with underscore+number suffix (`word_12345`) | +3 |
| Username ending in 3+ digits | +2 |
| 4+ consecutive consonants in username (`zpqhoemtxwkb`) | +2 |
| Low vowel ratio in username (<18%) | +2 |
| Account < 7 days old | +3 |
| Account 7–30 days old | +2 |
| Account 30–180 days old | +1 |
| No profile banner | +1 |
| Repeated character patterns in username | +1 |

Score ≥ 5 → **ban**. Score ≥ 3 → **flag in log channel**.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + discord.js v14
- Bot: CloneGuard (runs alongside the HTTP server in the same process)

## User preferences

_Populate as you build._
