import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StrKey } from "@stellar/stellar-sdk";
import { api } from "../api";
import EventTable from "../components/EventTable";
import OracleBondsTable from "../components/OracleBondsTable";
import Skeleton from "../components/Skeleton";
import { useOracleBonds } from "../hooks/useOracleBonds";
import { formatXlm, type OracleBondStatus } from "../oracleBonds";

type ProfileTab = "bets" | "bonds";

const initialTotals: Record<OracleBondStatus, number> = {
  escrowed: 0,
  returned: 0,
  slashed: 0,
};

export default function ProfilePage() {
  const { address: addressParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const address = addressParam ?? searchParams.get("address") ?? "";

  const [searchInput, setSearchInput] = useState(address);
  const [tab, setTab] = useState<ProfileTab>("bets");
  const [page, setPage] = useState(1);

  const isValidAddress = Boolean(address) && StrKey.isValidEd25519PublicKey(address);
  const bonds = useOracleBonds(address);

  const { data, isLoading } = useQuery({
    queryKey: ["wallet", address, page],
    queryFn: () => api.wallet(address, page),
    enabled: tab === "bets" && isValidAddress,
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 25;
  const totals = bonds.reduce(
    (acc, bond) => {
      acc[bond.status] += bond.amountXlm;
      return acc;
    },
    { ...initialTotals }
  );

  useEffect(() => {
    setSearchInput(address);
  }, [address]);

  useEffect(() => {
    document.title = address
      ? `Profile ${address} - Soroban Smart Block Explorer`
      : "User Profile - Soroban Smart Block Explorer";
  }, [address]);

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = searchInput.trim();
    if (!value) return;
    navigate(`/profile?address=${encodeURIComponent(value)}`);
    setPage(1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card">
        <h2 style={{ marginBottom: 8 }}>User Profile</h2>
        <p style={{ color: "var(--muted)", marginBottom: 12 }}>
          Track your betting history and the oracle bonds you have escrowed as a submitter or challenger.
        </p>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Enter Stellar address"
            aria-label="Stellar address"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 12 }}
          />
          <button type="submit">View profile</button>
        </form>
        {address && (
          <code style={{ display: "block", marginTop: 12, fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>
            {address}
          </code>
        )}
      </section>

      <div className="profile-tabs" role="tablist" aria-label="Profile sections">
        <button
          type="button"
          role="tab"
          id="profile-tab-bets"
          aria-selected={tab === "bets"}
          aria-controls="profile-panel-bets"
          className="profile-tab"
          onClick={() => setTab("bets")}
        >
          Bet History
        </button>
        <button
          type="button"
          role="tab"
          id="profile-tab-bonds"
          aria-selected={tab === "bonds"}
          aria-controls="profile-panel-bonds"
          className="profile-tab"
          onClick={() => setTab("bonds")}
        >
          Oracle Bonds <span className="badge">{bonds.length}</span>
        </button>
      </div>

      {tab === "bets" ? (
        <section role="tabpanel" id="profile-panel-bets" aria-labelledby="profile-tab-bets" className="card">
          <h3 style={{ marginBottom: 12 }}>Bet History</h3>
          {!address ? (
            <p style={{ color: "var(--muted)" }}>Enter a Stellar address to view bet history.</p>
          ) : !isValidAddress ? (
            <p style={{ color: "var(--muted)" }}>Invalid Stellar address.</p>
          ) : isLoading ? (
            <Skeleton />
          ) : (
            <EventTable
              events={events}
              emptyMessage="No bets found for this address."
              emptySubtitle="This address has no indexed betting events."
            />
          )}
          {isValidAddress && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                ← Prev
              </button>
              <span style={{ padding: "6px 10px", color: "var(--muted)" }}>Page {page}</span>
              <button
                type="button"
                disabled={page * limit >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </section>
      ) : (
        <section role="tabpanel" id="profile-panel-bonds" aria-labelledby="profile-tab-bonds">
          <div className="bond-summary" style={{ marginBottom: 12 }}>
            <div className="card">
              <span>Escrowed</span>
              <strong>{formatXlm(totals.escrowed)}</strong>
            </div>
            <div className="card">
              <span>Returned</span>
              <strong>{formatXlm(totals.returned)}</strong>
            </div>
            <div className="card">
              <span>Slashed</span>
              <strong>{formatXlm(totals.slashed)}</strong>
            </div>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Oracle Bonds</h3>
            {!address ? (
              <p style={{ color: "var(--muted)" }}>Enter a Stellar address to view oracle bonds.</p>
            ) : !isValidAddress ? (
              <p style={{ color: "var(--muted)" }}>Invalid Stellar address.</p>
            ) : (
              <OracleBondsTable
                bonds={bonds}
                emptyMessage="No oracle bonds found for this address."
                emptySubtitle="Bonds posted to oracle markets will appear here."
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
