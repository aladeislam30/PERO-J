import type { DisputeTimelineEvent } from "../disputes/types";

interface Props {
  events: DisputeTimelineEvent[];
}

export default function DisputeTimeline({ events }: Props) {
  if (!events.length) {
    return <p style={{ color: "var(--muted)" }}>No dispute history recorded yet.</p>;
  }

  return (
    <ol className="timeline">
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="timeline-item">
          <span className="timeline-marker" aria-hidden="true" />
          <div>
            <strong>{event.title}</strong>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              {formatDate(event.at)}
            </div>
            {event.description && <p style={{ marginTop: 6 }}>{event.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}
