import type { CouncilVote } from "../disputes/types";

interface Props {
  votes: CouncilVote[];
  councilSize: number;
}

export default function CouncilVoteProgress({ votes, councilSize }: Props) {
  const cast = Math.min(votes.length, councilSize);
  const percent = councilSize > 0 ? Math.round((cast / councilSize) * 100) : 0;
  const submitterVotes = votes.filter((vote) => vote.side === "submitter").length;
  const challengerVotes = votes.filter((vote) => vote.side === "challenger").length;

  return (
    <div>
      <p style={{ fontWeight: 600, marginBottom: 8 }}>
        {cast} of {councilSize} votes reached
      </p>
      <div
        className="vote-progress"
        role="progressbar"
        aria-label="Council votes cast"
        aria-valuemin={0}
        aria-valuemax={councilSize}
        aria-valuenow={cast}
      >
        <div className="vote-progress-bar" style={{ width: `${percent}%` }} />
      </div>
      <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13 }}>
        Submitter: {submitterVotes} · Challenger: {challengerVotes}
      </p>
      <ul className="vote-list">
        {votes.slice(0, councilSize).map((vote) => (
          <li key={vote.voter}>
            <code title={vote.voter}>{shorten(vote.voter)}</code>
            <span className={`badge ${vote.side === "submitter" ? "green" : "red"}`}>{vote.side}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shorten(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
