"use client";

/* ── 应用内「消息中心」共享状态（状态 + 持久化，无 React、无网络）────────────
 * 用于承载「只看一次就消失」的系统级提示（本地更新需重启、dev server
 * 重启、**应用服务断开与启动**等），让它们以消息列表的形式常驻：底部状态栏
 * 有铃铛按钮 + 未读数量，点开可全屏查看正文，避免信息一闪而过无处回看。
 *
 * 本文件只定义状态与动作，不 import 任何 React 组件 / 不发请求；
 * 消息的生产（谁触发 push）与展示（面板 UI）在 container/组件层分别接入，
 * 与规范 17 四层归属一致。
 */

import { create } from "zustand";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import { nextId } from "~/lib/unique-id";

export type MessageKind = "update" | "restart" | "offline" | "info";

export interface MessageRecord {
  /** 短 id，幂等去重用 */
  id: string;
  /** 消息类型：更新/重启/断开/其他 */
  kind: MessageKind;
  /** 一句话标题（状态栏 tooltip / 列表标题行） */
  title: string;
  /** 正文（全屏查看的消息内容，可多行换行） */
  body: string;
  /** Unix 时间戳（ms） */
  time: number;
  /** 是否已读（决定状态栏未读计数） */
  read: boolean;
}

/** 供 push 传入的载荷（id/time/read 由 store 补全）。 */
export type NewMessage = Omit<MessageRecord, "id" | "time" | "read">;

export interface MessageCenterState {
  /** 全屏消息面板是否打开 */
  open: boolean;
  /** 最新在前 */
  messages: MessageRecord[];
  /** 是否已经从持久化里恢复过（只恢复一次，见 `hydrate`）。 */
  hydrated: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  /** 新增一条消息；未读，排到最前。 */
  push: (m: NewMessage) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  /** 清空所有消息 */
  clear: () => void;
  /** 从持久化里恢复消息（挂载后调一次，见文件末尾的接线说明）。 */
  hydrate: () => void;
}

/* id 走全库唯一出口 `~/lib/unique-id` —— 收口前这里自写「时间戳 + 计数器」，
 * 而且计数器**取模回绕**（`(msgSeq + 1) % 1_000_000`）：转一圈之后同一毫秒内
 * 的两条消息会拿到同一个 id。消息中心按 id 标记已读 / 删除，撞 id 的表现是
 * 「删一条把另一条一起删了」。 */
function makeId(): string {
  return nextId("msg_");
}

const MAX_MESSAGES = 200;

export const useMessageCenterStore = create<MessageCenterState>((set, get) => ({
  open: false,
  messages: [],
  hydrated: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set({ open: !get().open }),
  push: (m) =>
    set((s) => ({
      messages: [
        { ...m, id: makeId(), time: Date.now(), read: false },
        ...s.messages,
      ].slice(0, MAX_MESSAGES),
    })),
  markRead: (id) =>
    set((s) => ({
      messages: s.messages.map((x) => (x.id === id ? { ...x, read: true } : x)),
    })),
  markAllRead: () =>
    set((s) => ({
      messages: s.messages.map((x) => (x.read ? x : { ...x, read: true })),
    })),
  remove: (id) =>
    set((s) => ({ messages: s.messages.filter((x) => x.id !== id) })),
  clear: () => set({ messages: [] }),
  hydrate: () =>
    set((s) => ({
      hydrated: true,
      messages: restoreMessages(s.messages),
    })),
}));

/* ── 持久化：消息中心此前是纯内存的，于是「记了等于没记」 ──────────────────
 *
 * 消息中心记的恰恰是**应用服务断开 / 启动**这类事件，而它们的观察窗口恰好覆盖
 * 一次整页刷新：应用服务重启会让 Next 的客户端重连并重载页面，内存里的消息随之
 * 归零 —— 于是用户回到应用打开铃铛看到的是空的，只能得出「记了但没生效」的结论。
 * 落一份 `localStorage` 之后，「刚才断开过一次、因为什么、持续多久」在刷新之后
 * 仍然查得到，这正是这个面板存在的意义（留底，而不是一闪而过）。
 *
 * ## 为什么恢复走 `hydrate()` 而不是模块加载时就读
 *
 * 模块加载发生在 SSR 与客户端各一份，客户端那一份在**首帧渲染之前**就把消息填上，
 * 于是服务端渲染出的「铃铛无角标」与客户端首帧的「角标 N」对不上 —— 一次水合不
 * 匹配。`hydrate()` 由组件在**挂载之后**调一次，首帧与 SSR 完全一致。
 *
 * ## 读回来时逐条校验，而不是整体相信
 *
 * 存的是 JSON，坏数据（手工改过、版本降级、写到一半）都可能出现，而这份数据的
 * 消费者是「已经出故障时」的界面：读不出来必须回落到「没有消息」，而不是抛错把
 * 面板整个打不开。
 */

/** 持久化键（带版本号：形状变了就换键，不去猜旧数据怎么迁）。 */
export const MESSAGE_CENTER_STORAGE_KEY = "comfyapp:message-center:v1";

const MESSAGE_KINDS: readonly MessageKind[] = [
  "update",
  "restart",
  "offline",
  "info",
];

/** 一条记录是否可用（字段齐、类型对、kind 认识）。 */
function asMessageRecord(raw: unknown): MessageRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  if (typeof o.title !== "string" || typeof o.body !== "string") return null;
  if (typeof o.time !== "number" || !Number.isFinite(o.time)) return null;
  if (typeof o.read !== "boolean") return null;
  if (
    typeof o.kind !== "string" ||
    !MESSAGE_KINDS.includes(o.kind as MessageKind)
  ) {
    return null;
  }
  return {
    id: o.id,
    kind: o.kind as MessageKind,
    title: o.title,
    body: o.body,
    time: o.time,
    read: o.read,
  };
}

/** 从持久化里读回消息；没存过 / 存坏了 / 没有任何一条可用 → 空数组。 */
function readPersistedMessages(): MessageRecord[] {
  const raw = readStorageJson<unknown>(MESSAGE_CENTER_STORAGE_KEY, null);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(asMessageRecord)
    .filter((m): m is MessageRecord => m !== null)
    .slice(0, MAX_MESSAGES);
}

/** 当前内存里的消息是否已经等于持久化里那一份（避免恢复时空跑一次渲染）。 */
function sameAsPersisted(current: MessageRecord[]): boolean {
  const persisted = readPersistedMessages();
  if (persisted.length !== current.length) return false;
  return persisted.every((m, i) => {
    const c = current[i];
    return (
      c?.id === m.id &&
      c.read === m.read &&
      c.title === m.title &&
      c.body === m.body
    );
  });
}

/** 恢复：与当前内容相同就原样返回（不给 store 塞一份等值的新数组）。 */
function restoreMessages(current: MessageRecord[]): MessageRecord[] {
  return sameAsPersisted(current) ? current : readPersistedMessages();
}

useMessageCenterStore.subscribe((state, prev) => {
  /* 只在 `messages` 换了引用时写：开关面板 / 标记已读之外的动作不该碰存储。 */
  if (state.messages !== prev.messages) {
    writeStorageJson(MESSAGE_CENTER_STORAGE_KEY, state.messages);
  }
});
