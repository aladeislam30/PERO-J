/**
 * backend/shared/notifier.ts
 *
 * Lightweight Discord & Slack webhook notification bot for high-severity alerts,
 * oracle disputes, and protocol audit events.
 *
 * Features:
 * - Rich embeds (Discord) and Block Kit attachments (Slack) with severity color bars.
 * - Direct links to the web UI.
 * - Dedicated channel routing:
 *     - #alerts-critical
 *     - #oracle-disputes
 *     - #audit-events
 * - Sliding window rate limiter to guard against alert storms flooding channels.
 */

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertChannel = "alerts-critical" | "oracle-disputes" | "audit-events";

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
  url?: string;
  timestamp?: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface WebhookConfig {
  discordWebhookUrls?: Partial<Record<AlertChannel, string>>;
  slackWebhookUrls?: Partial<Record<AlertChannel, string>>;
  webUiBaseUrl?: string;
  rateLimitMaxPerMinute?: number;
}

export interface NotificationResult {
  sent: boolean;
  rateLimited?: boolean;
  destinations: {
    discord?: boolean;
    slack?: boolean;
  };
  error?: string;
}

// Severity color codes
export const SEVERITY_COLORS = {
  critical: {
    hex: "#EF4444",
    decimal: 0xef4444, // Red
  },
  warning: {
    hex: "#F59E0B",
    decimal: 0xf59e0b, // Amber
  },
  info: {
    hex: "#3B82F6",
    decimal: 0x3b82f6, // Blue
  },
} as const;

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
  private timestamps: Map<AlertChannel, number[]> = new Map();
  private maxPerMinute: number;

  constructor(maxPerMinute = 30) {
    this.maxPerMinute = maxPerMinute;
  }

  isRateLimited(channel: AlertChannel, now = Date.now()): boolean {
    const windowStart = now - 60_000;
    const history = (this.timestamps.get(channel) || []).filter(
      (ts) => ts > windowStart
    );

    if (history.length >= this.maxPerMinute) {
      this.timestamps.set(channel, history);
      return true;
    }

    history.push(now);
    this.timestamps.set(channel, history);
    return false;
  }

  reset(): void {
    this.timestamps.clear();
  }
}

/**
 * Notifier bot managing alert payloads, formatting, and webhook dispatches.
 */
export class NotifierBot {
  private config: WebhookConfig;
  private rateLimiter: ChannelRateLimiter;

  constructor(config: WebhookConfig = {}) {
    this.config = {
      webUiBaseUrl:
        config.webUiBaseUrl ||
        process.env.WEB_UI_BASE_URL ||
        "https://app.pero-j.io",
      rateLimitMaxPerMinute:
        config.rateLimitMaxPerMinute ??
        (Number(process.env.ALERT_RATE_LIMIT_PER_MINUTE) || 30),
      discordWebhookUrls: config.discordWebhookUrls || {
        "alerts-critical": process.env.DISCORD_WEBHOOK_CRITICAL,
        "oracle-disputes": process.env.DISCORD_WEBHOOK_ORACLE_DISPUTES,
        "audit-events": process.env.DISCORD_WEBHOOK_AUDIT_EVENTS,
      },
      slackWebhookUrls: config.slackWebhookUrls || {
        "alerts-critical": process.env.SLACK_WEBHOOK_CRITICAL,
        "oracle-disputes": process.env.SLACK_WEBHOOK_ORACLE_DISPUTES,
        "audit-events": process.env.SLACK_WEBHOOK_AUDIT_EVENTS,
      },
    };
    this.rateLimiter = new ChannelRateLimiter(this.config.rateLimitMaxPerMinute);
  }

  /**
   * Format Discord Rich Embed.
   */
  formatDiscordPayload(alert: AlertPayload) {
    const color = SEVERITY_COLORS[alert.severity].decimal;
    const fullUrl = alert.url
      ? (alert.url.startsWith("http") ? alert.url : `${this.config.webUiBaseUrl}${alert.url}`)
      : this.config.webUiBaseUrl;

    const embed: Record<string, unknown> = {
      title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      description: alert.description,
      color,
      url: fullUrl,
      timestamp: alert.timestamp || new Date().toISOString(),
      footer: {
        text: `PERO-J Monitoring • #${alert.channel}`,
      },
    };

    if (alert.fields && alert.fields.length > 0) {
      embed.fields = alert.fields.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? true,
      }));
    }

    return {
      embeds: [embed],
    };
  }

  /**
   * Format Slack Block Kit payload with colored attachment bar.
   */
  formatSlackPayload(alert: AlertPayload) {
    const colorHex = SEVERITY_COLORS[alert.severity].hex;
    const fullUrl = alert.url
      ? (alert.url.startsWith("http") ? alert.url : `${this.config.webUiBaseUrl}${alert.url}`)
      : this.config.webUiBaseUrl;

    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${alert.description}\n*Target Channel:* #${alert.channel}`,
        },
      },
    ];

    if (alert.fields && alert.fields.length > 0) {
      blocks.push({
        type: "section",
        fields: alert.fields.map((f) => ({
          type: "mrkdwn",
          text: `*${f.name}:*\n${f.value}`,
        })),
      });
    }

    if (fullUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View in Web UI",
            },
            url: fullUrl,
            style: alert.severity === "critical" ? "danger" : "primary",
          },
        ],
      });
    }

    return {
      attachments: [
        {
          color: colorHex,
          blocks,
        },
      ],
    };
  }

  /**
   * Dispatch alert to configured webhook endpoints with rate limiting.
   */
  async notify(alert: AlertPayload): Promise<NotificationResult> {
    if (this.rateLimiter.isRateLimited(alert.channel)) {
      console.warn(
        `[NotifierBot] Rate limit exceeded on channel #${alert.channel}. Alert suppressed to prevent storm.`
      );
      return {
        sent: false,
        rateLimited: true,
        destinations: {},
      };
    }

    const discordUrl = this.config.discordWebhookUrls?.[alert.channel];
    const slackUrl = this.config.slackWebhookUrls?.[alert.channel];

    const results: NotificationResult["destinations"] = {};

    // Dispatch to Discord
    if (discordUrl) {
      try {
        const body = this.formatDiscordPayload(alert);
        const res = await fetch(discordUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        results.discord = res.ok;
      } catch (err: any) {
        console.error(`[NotifierBot] Discord webhook error: ${err.message}`);
        results.discord = false;
      }
    }

    // Dispatch to Slack
    if (slackUrl) {
      try {
        const body = this.formatSlackPayload(alert);
        const res = await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        results.slack = res.ok;
      } catch (err: any) {
        console.error(`[NotifierBot] Slack webhook error: ${err.message}`);
        results.slack = false;
      }
    }

    const sent = Boolean(results.discord || results.slack);
    return {
      sent,
      rateLimited: false,
      destinations: results,
    };
  }

  /**
   * Helper: Send critical system alert to #alerts-critical.
   */
  async sendCriticalAlert(
    title: string,
    description: string,
    fields?: AlertField[],
    url?: string
  ): Promise<NotificationResult> {
    return this.notify({
      channel: "alerts-critical",
      severity: "critical",
      title,
      description,
      fields,
      url,
    });
  }

  /**
   * Evaluate the `MarketStuckInUnresolved` alert rule:
   *   count(markets{status="open", ends_at_elapsed_hours > 48}) > 0
   * Returns the markets that breach the SLA window.
   */
  evaluateStuckMarkets(markets: StuckMarket[]): StuckMarket[] {
    return markets.filter(
      (m) =>
        (m.status ?? "open") === "open" &&
        m.endsAtElapsedHours > STUCK_MARKET_SLA_HOURS
    );
  }

  /**
   * Evaluate the `CouncilVoteStalled` alert rule:
   *   count(disputes{status="escalated", elapsed_hours > 24, votes_cast < 4}) > 0
   * Returns the disputes that breach the council SLA window.
   */
  evaluateStalledDisputes(disputes: StalledDispute[]): StalledDispute[] {
    return disputes.filter(
      (d) =>
        (d.status ?? "escalated") === "escalated" &&
        d.elapsedHours > COUNCIL_VOTE_SLA_HOURS &&
        d.votesCast < COUNCIL_MIN_VOTES
    );
  }

  /**
   * Helper: Page operators when markets remain unhandled past the SLA window.
   * Includes affected market IDs in the alert annotations.
   */
  async sendStuckMarketAlert(
    markets: StuckMarket[]
  ): Promise<NotificationResult> {
    const stuck = this.evaluateStuckMarkets(markets);
    if (stuck.length === 0) {
      return { sent: false, destinations: {} };
    }

    const ids = stuck.map((m) => m.id);
    return this.notify({
      channel: "alerts-critical",
      severity: "critical",
      title: "MarketStuckInUnresolved",
      description: `${stuck.length} market(s) open >${STUCK_MARKET_SLA_HOURS}h past expiry without resolution.`,
      fields: [
        { name: "Affected Market IDs", value: ids.join(", "), inline: false },
        {
          name: "Max Elapsed (h)",
          value: String(Math.max(...stuck.map((m) => m.endsAtElapsedHours))),
        },
      ],
      metadata: { rule: "MarketStuckInUnresolved", marketIds: ids },
    });
  }

  /**
   * Helper: Page operators when escalated disputes stall in council voting.
   * Includes affected dispute IDs in the alert annotations.
   */
  async sendCouncilVoteStalledAlert(
    disputes: StalledDispute[]
  ): Promise<NotificationResult> {
    const stalled = this.evaluateStalledDisputes(disputes);
    if (stalled.length === 0) {
      return { sent: false, destinations: {} };
    }

    const ids = stalled.map((d) => d.id);
    return this.notify({
      channel: "oracle-disputes",
      severity: "critical",
      title: "CouncilVoteStalled",
      description: `${stalled.length} escalated dispute(s) with <${COUNCIL_MIN_VOTES} votes after >${COUNCIL_VOTE_SLA_HOURS}h.`,
      fields: [
        { name: "Affected Dispute IDs", value: ids.join(", "), inline: false },
        {
          name: "Votes Cast",
          value: stalled.map((d) => `${d.id}: ${d.votesCast}`).join(", "),
          inline: false,
        },
      ],
      metadata: { rule: "CouncilVoteStalled", disputeIds: ids },
    });
  }
}
