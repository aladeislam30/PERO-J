import { AdapterDataError, BaseAdapter } from "./base.js";
import { requireString } from "./http.js";

function parseScore(entry, source) {
  const score = entry?.score;
  const valid =
    typeof entry?.name === "string" &&
    (typeof score === "number" || (typeof score === "string" && score.trim() !== "")) &&
    Number.isFinite(Number(score));
  if (!valid) {
    throw new AdapterDataError(`${source}: missing or invalid score`);
  }
  return { name: entry.name, score: Number(score) };
}

export class TheOddsApiAdapter extends BaseAdapter {
  constructor({ apiKey, ...options } = {}) {
    super({ name: "oddsapi", rateLimit: { capacity: 2, refillPerSecond: 1 }, ...options });
    this.apiKey = apiKey;
  }

  async resolve(params) {
    const sport = requireString(params?.sport, "sport");
    const eventId = requireString(params?.event_id, "event_id");
    const winner = requireString(params?.winner, "winner");
    const url = new URL(
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/scores/`,
    );
    url.searchParams.set("daysFrom", "3");
    url.searchParams.set("apiKey", this.apiKey ?? process.env.ODDSAPI_API_KEY ?? "");
    const data = await this.getJson(url.href);
    if (!Array.isArray(data)) {
      throw new AdapterDataError(`${this.name}: scores response must be an array`);
    }
    const game = data.find((g) => g?.id === eventId);
    if (game?.completed !== true) {
      throw new AdapterDataError(`${this.name}: event not completed`);
    }
    if (!Array.isArray(game.scores) || game.scores.length !== 2) {
      throw new AdapterDataError(`${this.name}: expected two scores`);
    }
    const [a, b] = game.scores.map((s) => parseScore(s, this.name));
    if (winner !== a.name && winner !== b.name && winner !== "Draw") {
      throw new AdapterDataError(`${this.name}: "${winner}" did not play in this event`);
    }
    const observed = a.score === b.score ? "Draw" : a.score > b.score ? a.name : b.name;
    return observed === winner;
  }
}
