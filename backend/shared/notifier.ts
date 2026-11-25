/**
 * Lightweight Discord/Slack webhook notification bot for high-severity alerts.
 *
 * Formats alert payloads as rich embeds (Discord) / Block Kit attachments
 * (Slack) with severity color bars and direct links to the web UI, and
 * rate-limits per channel to prevent flooding during alert storms.
 */

export type AlertChannel = "alerts-critical" | "oracle-disputes" | "audit-events";

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface AlertPayload {
  channel: AlertChannel;
  severity: AlertSeverity;
  title: string;
  description: string;
  fields?: AlertField[];
  /** Path (or absolute URL) to the relevant page in the web UI. */
  url?: string;
}

export interface SeverityColor {
  /** Decimal color used by Discord embeds. */
  decimal: number;
  /** Hex color used by Slack attachments. */
  hex: string;
}

export const SEVERITY_COLORS: Record<AlertSeverity, SeverityColor> = {
  critical: { decimal: 0xed4245, hex: "#ed4245" },
  warning: { decimal: 0xfee75c, hex: "#fee75c" },
  info: { decimal: 0x5865f2, hex: "#5865f2" },
};

export interface DiscordEmbed {
  title: string;
  description: string;
  url?: string;
  color: number;
  timestamp: string;
  fields?: AlertField[];
}

export interface DiscordPayload {
  embeds: DiscordEmbed[];
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: { type: string; text: string }[];
}

export interface SlackAttachment {
  color: string;
  blocks: SlackBlock[];
}

export interface SlackPayload {
  attachments: SlackAttachment[];
}

export interface NotifierConfig {
  webUiBaseUrl: string;
  /** Optional per-channel webhook URLs. */
  webhooks?: Partial<Record<AlertChannel, string>>;
  /** Max alerts per channel per rolling minute. Defaults to 5. */
  rateLimitPerMinute?: number;
}

const RATE_LIMIT_WINDOW_MS = 60_000;

/**

 * SLA thresholds for stuck-market and council-inactivity alert rules.
 */
export const STUCK_MARKET_SLA_HOURS = 48;
export const COUNCIL_VOTE_SLA_HOURS = 24;
export const COUNCIL_MIN_VOTES = 4;

/**
 * A market that has remained open past its expiry beyond the SLA window.
 */
export interface StuckMarket {
  id: string;
  endsAtElapsedHours: number;
  status?: string;
}

/**
 * An escalated dispute awaiting council votes.
 */
export interface StalledDispute {
  id: string;
  elapsedHours: number;
  votesCast: number;
  status?: string;
}

/**
 * In-memory sliding window rate limiter per channel.

 */
export class ChannelRateLimiter {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(maxPerWindow = 5, windowMs = RATE_LIMIT_WINDOW_MS) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  /**
   * Returns true if the channel is currently rate limited. When not limited,
   * the call records a hit for the channel.
   */
  isRateLimited(channel: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(channel) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.maxPerWindow) {
      this.hits.set(channel, recent);
      return true;
    }

    recent.push(now);
    this.hits.set(channel, recent);
    return false;
  }
}

export class NotifierBot {
  private readonly config: NotifierConfig;
  private readonly limiter: ChannelRateLimiter;

  constructor(config: NotifierConfig) {
    this.config = config;
    this.limiter = new ChannelRateLimiter(config.rateLimitPerMinute ?? 5);
  }

  private resolveUrl(url?: string): string | undefined {
    if (!url) return undefined;
    if (/^https?:\/\//i.test(url)) return url;
    const base = this.config.webUiBaseUrl.replace(/\/$/, "");
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  formatDiscordPayload(alert: AlertPayload): DiscordPayload {
    const embed: DiscordEmbed = {
      title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      description: alert.description,
      color: SEVERITY_COLORS[alert.severity].decimal,
      timestamp: new Date().toISOString(),
    };

    const url = this.resolveUrl(alert.url);
    if (url) embed.url = url;
    if (alert.fields?.length) embed.fields = alert.fields;

    return { embeds: [embed] };
  }

  formatSlackPayload(alert: AlertPayload): SlackPayload {
    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: alert.description },
      },
    ];

    if (alert.fields?.length) {
      blocks.push({
        type: "section",
        fields: alert.fields.map((f) => ({
          type: "mrkdwn",
          text: `*${f.name}*\n${f.value}`,
        })),
      });
    }

    const url = this.resolveUrl(alert.url);
    if (url) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `<${url}|View in dashboard>` },
      });
    }

    return {
      attachments: [
        { color: SEVERITY_COLORS[alert.severity].hex, blocks },
      ],
    };
  }

  /**
   * Posts an alert to the configured Discord and/or Slack webhook for its
   * channel. Returns false when rate limited or no webhook is configured.
   */
  async notify(alert: AlertPayload): Promise<boolean> {
    if (this.limiter.isRateLimited(alert.channel)) {
      return false;
    }

    const webhook = this.config.webhooks?.[alert.channel];
    if (!webhook) return false;

    const isSlack = webhook.includes("hooks.slack.com");
    const body = isSlack
      ? this.formatSlackPayload(alert)
      : this.formatDiscordPayload(alert);

    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

