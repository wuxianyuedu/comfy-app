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
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { nextId } from "~/lib/unique-id";

type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** 自动关闭前的毫秒数；0 = 手动关闭前一直停留 */
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
    ring: "border-success-strong/30",
    icon: "check",
    iconColor: "text-success-strong",
  },
  error: {
    ring: "border-destructive/30",
    icon: "close",
    iconColor: "text-danger-strong",
  },
  info: {
    ring: "border-primary-500/30",
    icon: "info",
    iconColor: "text-primary-strong",
  },
  loading: {
    ring: "border-border-strong",
    icon: "loader",
    /* 转圈动画由 <Spinner /> 自带（规范 16 §16.2.3 的 P3 判据：全库只留一处
       `animate-spin`），这里只留底色语义。 */
    iconColor: "text-ink-soft",
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
      /* id 走全库唯一出口（规范 16 §16.2.4.36）—— 收口前这里是
       * 「毫秒数 + 5 位随机后缀」，与日志 / 消息中心那两处的「36 进制时间戳 +
       * 递增序号」是**两种形状**：同一批产生的两条 toast 谁在前谁在后，
       * 取决于哪一种。 */
      const id = nextId("t_");
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
      <div className="z-toast pointer-events-none fixed right-5 bottom-8 flex w-[340px] flex-col gap-2.5">
        {items.map((item) => {
          const st = KIND_STYLE[item.kind];
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${st.ring} bg-panel/95 p-3.5 shadow-xl shadow-black/8 backdrop-blur-md transition-all dark:shadow-black/40`}
            >
              <div className={`mt-0.5 ${st.iconColor}`}>
                {item.kind === "loading" ? (
                  <Spinner className="size-4" />
                ) : (
                  <Icon name={st.icon} size={16} />
                )}
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
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => dismiss(item.id)}
                className="text-ink-muted hover:text-ink-bright hover:bg-transparent"
                aria-label="关闭"
              >
                <X size={14} />
              </Button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
