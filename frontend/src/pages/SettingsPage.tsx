import { useTheme, type ThemePreference } from "../theme";

const options: { value: ThemePreference; label: string; description: string }[] = [
  {
    value: "light",
    label: "Light",
    description: "Bright, high-contrast colors for well-lit environments.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Low-glare colors for low-light environments.",
  },
  {
    value: "system",
    label: "System",
    description: "Follow the device's color scheme setting automatically.",
  },
];

export default function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Manage how the explorer looks on this device.
        </p>
      </div>

      <section className="card" aria-labelledby="theme-heading" style={{ display: "grid", gap: 12 }}>
        <h2 id="theme-heading" style={{ fontSize: 16 }}>Theme</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Currently showing the {resolvedTheme} theme. Your preference is saved on this device.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {options.map(option => (
            <label
              key={option.value}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: 12,
                border: `1px solid ${theme === option.value ? "var(--accent-color)" : "var(--border-color)"}`,
                borderRadius: 8,
                background: theme === option.value ? "var(--surface-primary)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <span style={{ display: "grid", gap: 2 }}>
                <strong>{option.label}</strong>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
