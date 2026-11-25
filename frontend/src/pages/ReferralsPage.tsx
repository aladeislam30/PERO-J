import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { referralImageUrl, referralShareUrl } from "../api";

interface ReferralProfile {
  name: string;
  address: string;
  earnings: string;
}

const STORAGE_KEY = "ipredict.referral";

const emptyProfile: ReferralProfile = { name: "", address: "", earnings: "0" };

function loadProfile(): ReferralProfile {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile;
    const parsed = JSON.parse(raw) as Partial<ReferralProfile>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      address: typeof parsed.address === "string" ? parsed.address : "",
      earnings: typeof parsed.earnings === "string" ? parsed.earnings : "0",
    };
  } catch {
    return emptyProfile;
  }
}

export default function ReferralsPage() {
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState<ReferralProfile>(loadProfile);
  const [copied, setCopied] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      return;
    }
  }, [profile]);

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref) return;
    setProfile(current => (current.address ? current : { ...current, address: ref }));
  }, [searchParams]);

  const name = profile.name.trim() || "Friend";
  const earnings = profile.earnings.trim() || "0";
  const ref = profile.address.trim() || "ipredict";

  const shareUrl = useMemo(() => referralShareUrl({ name, earnings, ref }), [name, earnings, ref]);
  const imageUrl = useMemo(() => referralImageUrl({ name, earnings, ref }), [name, earnings, ref]);
  const appUrl = useMemo(() => {
    const url = new URL("/referrals", window.location.origin);
    url.searchParams.set("ref", ref);
    return url.toString();
  }, [ref]);

  const message =
    `Join ${name} on iPredict! I earn 0.5% whenever a friend bets with my referral. ` +
    `Use my link: ${appUrl}`;

  const shareLinks = [
    {
      label: "Share on X",
      color: "#ffffff",
      background: "#000000",
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      label: "Share on Telegram",
      color: "#ffffff",
      background: "#229ed9",
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(message)}`,
    },
    {
      label: "Share on WhatsApp",
      color: "#0d1117",
      background: "#25d366",
      href: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${message}\n${shareUrl}`)}`,
    },
  ];

  function update(field: keyof ReferralProfile, value: string) {
    setProfile(current => ({ ...current, [field]: value }));
    setImageFailed(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      return;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Referrals</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Earn 0.5% on every bet your invitees place. Build a share card and invite your friends.
        </p>
      </div>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>Your referral details</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Display name</span>
            <input
              type="text"
              value={profile.name}
              maxLength={40}
              placeholder="Friend"
              onChange={event => update("name", event.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Wallet address / referral code</span>
            <input
              type="text"
              value={profile.address}
              maxLength={80}
              placeholder="G…"
              onChange={event => update("address", event.target.value)}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Referral earnings (XLM)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={profile.earnings}
              onChange={event => update("earnings", event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="card" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ fontSize: 16 }}>Your referral link</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            readOnly
            value={shareUrl}
            aria-label="Referral link"
            onFocus={event => event.target.select()}
            style={{ flex: "1 1 320px", fontFamily: "monospace", fontSize: 12 }}
          />
          <button type="button" onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          Direct app link: <code style={{ fontFamily: "monospace" }}>{appUrl}</code>
        </p>
      </section>

      <section className="card" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ fontSize: 16 }}>One-click sharing</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{message}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {shareLinks.map(link => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: link.background,
                color: link.color,
                padding: "8px 14px",
                borderRadius: 6,
                fontWeight: 600,
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section className="card" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ fontSize: 16 }}>Share preview</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Social platforms use this 1200×630 image and the title, description and link above.
        </p>
        {imageFailed ? (
          <div style={{ padding: 24, border: "1px dashed var(--border-color)", borderRadius: 8, color: "var(--text-muted)" }}>
            Preview image unavailable. Start the API server to generate it.
          </div>
        ) : (
          <img
            src={imageUrl}
            alt="Generated referral share card"
            onError={() => setImageFailed(true)}
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border-color)", display: "block" }}
          />
        )}
      </section>
    </div>
  );
}
