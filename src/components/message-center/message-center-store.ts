"use client";

/* ── 应用内「消息中心」共享状态（纯状态，无副作用 / 无 IO）──────
 * 用于承载「只看一次就消失」的系统级提示（本地更新需重启、dev server
 * 重启等），让它们以消息列表的形式常驻：底部状态栏有铃铛按钮 + 未读数量，
 * 点开可全屏查看正文，避免信息一闪而过无处可回看。
 *
 * 本文件只定义状态与动作，不 import 任何 React 组件 / 不发请求；
 * 消息的生产（谁触发 push）与展示（面板 UI）在 container/组件层分别接入，
 * 与规范 17 四层归属一致。
 */

import { create } from "zustand";

import { nextId } from "~/lib/unique-id";

export type MessageKind = "update" | "restart" | "info";

export interface MessageRecord {
  /** 短 id，幂等去重用 */
  id: string;
  /** 消息类型：更新/重启/其他 */
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
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  /** 新增一条消息；未读，排到最前。 */
  push: (m: NewMessage) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  /** 清空所有消息 */
  clear: () => void;
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
}));
