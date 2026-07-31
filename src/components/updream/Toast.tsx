"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  useMemo,
} from "react";

type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** ms before auto-dismiss; 0 = sticky until dismissed */
  duration?: number;
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, "id">) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  loading: (title: string, description?: string) => string;
  update: (id: string, patch: Partial<Omit<ToastItem, "id">>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const KIND_STYLE: Record<ToastKind, { ring: string; icon: string; iconColor: string }> = {
  success: { ring: "border-emerald-500/30", icon: "✓", iconColor: "text-emerald-400" },
  error: { ring: "border-red-500/30", icon: "✕", iconColor: "text-red-400" },
  info: { ring: "border-violet-500/30", icon: "ℹ", iconColor: "text-violet-400" },
  loading: { ring: "border-white/15", icon: "◌", iconColor: "text-gray-300 animate-spin" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: string, duration?: number) => {
      const tm = timers.current.get(id);
      if (tm) clearTimeout(tm);
      if (duration && duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }
    },
    [dismiss]
  );

  const toast = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev, { ...t, id }]);
      schedule(id, t.duration ?? (t.kind === "loading" ? 0 : 3200));
      return id;
    },
    [schedule]
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<ToastItem, "id">>) => {
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.duration !== undefined) schedule(id, patch.duration);
    },
    [schedule]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ kind: "success", title, description }),
      error: (title, description) => toast({ kind: "error", title, description }),
      info: (title, description) => toast({ kind: "info", title, description }),
      loading: (title, description) => toast({ kind: "loading", title, description, duration: 0 }),
      update,
      dismiss,
    }),
    [toast, update, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[340px] flex-col gap-2.5">
        {items.map((t) => {
          const st = KIND_STYLE[t.kind];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${st.ring} bg-[#14141a]/95 p-3.5 shadow-xl shadow-black/40 backdrop-blur-md transition-all`}
            >
              <div className={`mt-0.5 text-base font-bold ${st.iconColor}`}>{st.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-100">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 break-words text-xs text-gray-400">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-gray-500 transition-colors hover:text-gray-200"
                aria-label="关闭"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
