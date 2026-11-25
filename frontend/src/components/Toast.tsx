import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastVariant = "error" | "warning" | "info" | "success";
export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  body?: string;
  duration?: number;
}

export interface ToastApi {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = toast.duration ?? 5000;
      setToasts((prev) => [...prev, { ...toast, id }]);
      if (duration > 0) {
        timers.current[id] = setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast]
  );

  const value = useMemo<ToastApi>(
    () => ({
      success: (message: string) => addToast({ variant: "success", title: message }),
      error: (message: string) => addToast({ variant: "error", title: message }),
      info: (message: string) => addToast({ variant: "info", title: message }),
      warning: (message: string) => addToast({ variant: "warning", title: message }),
      addToast,
      removeToast,
    }),
    [addToast, removeToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.variant}`}
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderLeftWidth: 4,
              borderLeftColor:
                toast.variant === "success" ? "var(--green)" :
                toast.variant === "error" ? "var(--red)" : "var(--accent)",
              borderRadius: 8,
              background: "var(--surface)",
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.15)",
              color: "var(--text)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{toast.title}</div>
              {toast.body && <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>{toast.body}</div>}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => removeToast(toast.id)}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                padding: "0 4px",
                fontSize: 18,
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}
