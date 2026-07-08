import {
  Client,
  GatewayIntentBits,
  Events,
  GuildMember,
  EmbedBuilder,
  TextChannel,
  Colors,
} from "discord.js";
import { inspectMember, type SuspicionReport } from "./detector.js";
import { logger } from "../lib/logger.js";

// ── threshold validation ───────────────────────────────────────────────────────

function parseThreshold(
  envKey: string,
  defaultValue: number,
  label: string,
): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.error(
      `Invalid ${label} env var "${envKey}"="${raw}" — must be a non-negative number. Using default ${defaultValue}.`,
    );
    return defaultValue;
  }
  return n;
}

// ── stats kept in memory ──────────────────────────────────────────────────────

export interface BotStats {
  started: Date;
  membersChecked: number;
  accountsBanned: number;
  accountsFlagged: number;
  recentActions: ActionRecord[];
}

export interface ActionRecord {
  timestamp: Date;
  guildName: string;
  username: string;
  accountCreated: Date;
  verdict: "ban" | "suspicious" | "safe";
  score: number;
  reasons: string[];
}

const MAX_RECENT = 50;

export const stats: BotStats = {
  started: new Date(),
  membersChecked: 0,
  accountsBanned: 0,
  accountsFlagged: 0,
  recentActions: [],
};

function recordAction(record: ActionRecord) {
  stats.recentActions.unshift(record);
  if (stats.recentActions.length > MAX_RECENT) {
    stats.recentActions.pop();
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function sendLogEmbed(
  member: GuildMember,
  report: SuspicionReport,
  logChannelId: string | undefined,
  banned: boolean,
) {
  if (!logChannelId) return;

  try {
    const channel = await member.client.channels.fetch(logChannelId);
    if (!channel?.isTextBased()) return;

    const color = banned
      ? Colors.Red
      : report.verdict === "suspicious"
        ? Colors.Yellow
        : Colors.Green;

    const title = banned
      ? "🔨 Clone Account Banned"
      : report.verdict === "suspicious"
        ? "⚠️ Suspicious Account Flagged"
        : "✅ Member Joined (Clean)";

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(`**${member.user.tag}** joined **${member.guild.name}**`)
      .addFields(
        {
          name: "Suspicion Score",
          value: `${report.score}`,
          inline: true,
        },
        {
          name: "Account Created",
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        {
          name: "Reasons",
          value:
            report.reasons.length > 0
              ? report.reasons.map((r) => `• ${r}`).join("\n")
              : "None",
        },
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `User ID: ${member.user.id}` })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err }, "Failed to send log embed");
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

export function createBot(): Client {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot will not start");
    return new Client({ intents: [] });
  }

  // Validate thresholds once at startup so bad env values fail loudly
  const banThreshold = parseThreshold("BAN_SCORE_THRESHOLD", 5, "ban threshold");
  const flagThreshold = parseThreshold("FLAG_SCORE_THRESHOLD", 3, "flag threshold");
  const logChannelId = process.env["DISCORD_LOG_CHANNEL_ID"];

  logger.info(
    { banThreshold, flagThreshold, logChannelId: logChannelId ?? "(not set)" },
    "CloneGuard bot starting",
  );

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info(
      { tag: c.user.tag, guilds: c.guilds.cache.size },
      "Discord bot ready",
    );
  });

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      stats.membersChecked++;

      const report = inspectMember(
        {
          username: member.user.username,
          hasAvatar: !!member.user.avatar,
          createdAt: member.user.createdAt,
        },
        banThreshold,
        flagThreshold,
      );

      logger.info(
        {
          guild: member.guild.name,
          user: member.user.tag,
          score: report.score,
          verdict: report.verdict,
          reasons: report.reasons,
        },
        "Member join evaluated",
      );

      const record: ActionRecord = {
        timestamp: new Date(),
        guildName: member.guild.name,
        username: member.user.tag,
        accountCreated: member.user.createdAt,
        verdict: report.verdict,
        score: report.score,
        reasons: report.reasons,
      };

      if (report.verdict === "ban") {
        try {
          await member.ban({
            reason: `[CloneGuard] Score ${report.score}. ${report.reasons.join("; ")}`,
            deleteMessageSeconds: 0,
          });
          stats.accountsBanned++;
          logger.info(
            { user: member.user.tag, score: report.score },
            "Banned clone account",
          );
          await sendLogEmbed(member, report, logChannelId, true);
        } catch (banErr) {
          logger.error(
            { banErr, user: member.user.tag },
            "Failed to ban member — check bot permissions (needs Ban Members)",
          );
        }
      } else if (report.verdict === "suspicious") {
        stats.accountsFlagged++;
        await sendLogEmbed(member, report, logChannelId, false);
      } else if (logChannelId && report.score > 0) {
        // Clean member with minor signals — log to channel if configured
        await sendLogEmbed(member, report, logChannelId, false);
      }

      recordAction(record);
    } catch (err) {
      logger.error({ err, user: member.user.tag }, "Error processing member join");
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.login(token).catch((err: Error) => {
    if (err.message?.includes("disallowed intents")) {
      logger.error(
        "Discord bot login failed: Server Members Intent is not enabled. " +
          "Go to https://discord.com/developers/applications → your bot → Bot → " +
          '"Privileged Gateway Intents" → enable "Server Members Intent".',
      );
    } else {
      logger.error({ err }, "Discord bot login failed");
    }
  });

  return client;
}
