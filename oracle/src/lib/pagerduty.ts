const EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";
const TIMEOUT_MS = 10_000;

export type FetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "text">>;

export interface PagerDutyTrigger {
  dedupKey: string;
  summary: string;
  severity: "critical" | "error" | "warning" | "info";
  source: string;
  component: string;
  group: string;
  class: string;
  details: Record<string, unknown>;
}

async function enqueue(body: object, fetchImpl: FetchImpl): Promise<void> {
  const response = await fetchImpl(EVENTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `PagerDuty Events API returned ${response.status}: ${await response.text()}`,
    );
  }
}

/** Open (or re-trigger, when `dedupKey` is already open) an incident. */
export function triggerIncident(
  routingKey: string,
  trigger: PagerDutyTrigger,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  return enqueue(
    {
      routing_key: routingKey,
      event_action: "trigger",
      dedup_key: trigger.dedupKey,
      payload: {
        summary: trigger.summary,
        source: trigger.source,
        severity: trigger.severity,
        timestamp: new Date().toISOString(),
        component: trigger.component,
        group: trigger.group,
        class: trigger.class,
        custom_details: trigger.details,
      },
    },
    fetchImpl,
  );
}

/** Resolve an incident. PagerDuty ignores keys with no open incident. */
export function resolveIncident(
  routingKey: string,
  dedupKey: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  return enqueue(
    { routing_key: routingKey, event_action: "resolve", dedup_key: dedupKey },
    fetchImpl,
  );
}
