"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  useMemo,
} from "react";
import { X } from "lucide-react";
import { Icon } from "~/components/ui/icon";

type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** ms before auto-dismiss; 0 = sticky until dismissed */
  duration?: number;
}

export interface ToastContextValue {
  toast: (t: Omit<ToastItem, "id">) => string;
  success: (title: string, description?: string, duration?: number) => string;
  error: (title: string, description?: string, duration?: number) => string;
  /** `duration` 覆盖默认 3.2s 自动收起时间；用于「这句话是要照着做的」这类提示
   *  （如陈旧实例的「重载一次即恢复」指引）——默认时长会让用户来不及读完。 */
  info: (title: string, description?: string, duration?: number) => string;
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

const KIND_STYLE: Record<
  ToastKind,
  { ring: string; icon: string; iconColor: string }
> = {
  success: {
    ring: "border-emerald-500/30",
    icon: "check",
    iconColor: "text-emerald-700 dark:text-emerald-400",
  },
  error: {
    ring: "border-red-500/30",
    icon: "close",
    iconColor: "text-red-700 dark:text-red-400",
  },
  info: {
    ring: "border-violet-500/30",
    icon: "info",
    iconColor: "text-violet-700 dark:text-violet-400",
  },
  loading: {
    ring: "border-border-strong",
    icon: "loader",
    iconColor: "text-ink-soft animate-spin",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((prev) => prev.id !== id));
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
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  const toast = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev, { ...t, id }]);
      schedule(id, t.duration ?? (t.kind === "loading" ? 0 : 3200));
      return id;
    },
    [schedule],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<ToastItem, "id">>) => {
      setItems((prev) =>
        prev.map((prev) => (prev.id === id ? { ...prev, ...patch } : prev)),
      );
      if (patch.duration !== undefined) schedule(id, patch.duration);
    },
    [schedule],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description, duration) =>
        toast({ kind: "success", title, description, duration }),
      error: (title, description, duration) =>
        toast({ kind: "error", title, description, duration }),
      info: (title, description, duration) =>
        toast({ kind: "info", title, description, duration }),
      loading: (title, description) =>
        toast({ kind: "loading", title, description, duration: 0 }),
      update,
      dismiss,
    }),
    [toast, update, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-8 z-100 flex w-[340px] flex-col gap-2.5">
        {items.map((item) => {
          const st = KIND_STYLE[item.kind];
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${st.ring} bg-panel/95 p-3.5 shadow-xl shadow-black/8 backdrop-blur-md transition-all dark:shadow-black/40`}
            >
              <div className={`mt-0.5 ${st.iconColor}`}>
                <Icon name={st.icon} size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-ink-bright text-sm font-semibold">
                  {item.title}
                </p>
                {item.description && (
                  <p className="text-ink-soft mt-0.5 text-xs break-words">
                    {item.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="text-ink-muted hover:text-ink-bright transition-colors"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
