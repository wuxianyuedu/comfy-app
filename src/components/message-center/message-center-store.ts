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

export type MessageRecord = {
  /** 正文（全屏查看的消息内容，可多行换行） */
  body: string;
  /** 短 id，幂等去重用 */
  id: string;
  /** 消息类型：更新/重启/断开/其他 */
  kind: MessageKind;
  /** 是否已读（决定状态栏未读计数） */
  read: boolean;
  /**
   * 这条消息属于**哪一次启动**（launcher 的 runId）；null = 写入时不知道。
   *
   * 存在的理由：消息中心里多次启动的记录此前混成一列平铺，用户分不清哪几条属于
   * 同一次启动——而这个面板记的恰恰是故障，分不清批次等于分不清故障次数。面板按
   * 它分组显示（判据见 `~/lib/shell/message-run-groups`）。
   *
   * 与 `run/runs/<日期>_<时分秒>-<runId>`、`run/app-service-exit.json` 的 runId
   * 同源，分组头带上它就能直接和日志目录对号。
   */
  runId: string | null;
  /** Unix 时间戳（ms） */
  time: number;
  /** 一句话标题（状态栏 tooltip / 列表标题行） */
  title: string;
};

/** 供 push 传入的载荷（id/time/read 由 store 补全，runId 缺省取当前启动）。 */
export type NewMessage = Omit<MessageRecord, "id" | "time" | "read" | "runId"> & {
  /** 缺省时由 store 用「当前是哪一次启动」盖上，于是各生产方不必各自去取。 */
  runId?: string | null;
  /**
   * **事件发生的时刻**（Unix 毫秒）；缺省取 push 那一刻。
   *
   * 生产方知道得比 store 准：应用服务断开那条要先把原因从盘上读回来（壳的 IPC），
   * push 因此比事件晚一个往返；恢复那条则可能几乎同时写进去。若 `time` 一律取
   * push 时刻，两条消息的先后就取决于「哪个往返先回来」而不是「哪件事先发生」
   * —— 消息中心按 `time` 倒序摆放与分组（`~/lib/shell/message-run-groups` 判的
   * 也是「连续同一 runId」），次序一翻，用户读到的因果就反了。
   */
  time?: number;
};

export type MessageCenterState = {
  /** 清空所有消息 */
  clear: () => void;
  /**
   * 当前是哪一次启动（运行时事实，**不持久化**）。
   *
   * 由探活链路在学到 runId 时写进来（`use-app-service-message-log` → 本 store）。
   * 两个用途：① 面板据此把「本次启动」那一组高亮出来；② `push` 缺省 runId 时
   * 用它盖戳，于是**所有**生产方（应用服务、代码更新、版本更新）都自动按启动
   * 分组，不需要每一个都去接一次探活。
   */
  currentRunId: string | null;
  /** 从持久化里恢复消息（挂载后调一次，见文件末尾的接线说明）。 */
  hydrate: () => void;
  /** 是否已经从持久化里恢复过（只恢复一次，见 `hydrate`）。 */
  hydrated: boolean;
  markAllRead: () => void;
  markRead: (id: string) => void;
  /** 最新在前 */
  messages: Array<MessageRecord>;
  /** 全屏消息面板是否打开 */
  open: boolean;
  /** 新增一条消息；未读，排到最前。 */
  push: (m: NewMessage) => void;
  remove: (id: string) => void;
  /** 记下当前是哪一次启动（runId 变化时由探活链路调用）。 */
  setCurrentRunId: (runId: string | null) => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
};

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
  currentRunId: null,
  setOpen: (open) => {
    set({ open });
  },
  toggleOpen: () => {
    set({ open: !get().open });
  },
  push: (m) => {
    set((s) => ({
      messages: [
        {
          ...m,
          /* runId **没给**时盖「当前这一次启动」：生产方（应用服务 / 代码更新 /
           * 版本更新）于是不必各自去接探活链路，也不会漏盖——漏盖的消息在面板上
           * 只能落到「未标记启动」那一组，而它本可以归对批次。
           *
           * 判 `=== undefined` 而不是 `??`：**显式给的 null 是「明确不知道」**
           * （纯手工 `pnpm dev` 起的服务、探活还没答过第一次），它必须留 null；
           * 被 `??` 补成当前启动，等于断言「它属于现在这次启动」——一个不知道的
           * 事实，而面板据此分组，断言错了就是分错批次。 */
          runId: m.runId === undefined ? s.currentRunId : m.runId,
          id: makeId(),
          time: m.time ?? Date.now(),
          read: false,
        },
        ...s.messages,
      ]
        /* 最新在前**按事件时刻排**（而不是「谁先 push 完」）：断开那条要先读原因，
         * 它的 push 天然比事件晚，靠插入次序摆放会把「断开 → 恢复」翻成反的。 */
        .sort((a, b) => b.time - a.time)
        .slice(0, MAX_MESSAGES),
    }));
  },
  setCurrentRunId: (runId) => {
    set({ currentRunId: runId });
  },
  markRead: (id) => {
    set((s) => ({
      messages: s.messages.map((x) => (x.id === id ? { ...x, read: true } : x)),
    }));
  },
  markAllRead: () => {
    set((s) => ({
      messages: s.messages.map((x) => (x.read ? x : { ...x, read: true })),
    }));
  },
  remove: (id) => {
    set((s) => ({ messages: s.messages.filter((x) => x.id !== id) }));
  },
  clear: () => {
    set({ messages: [] });
  },
  hydrate: () => {
    set((s) => ({
      hydrated: true,
      messages: restoreMessages(s.messages),
    }));
  },
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

/** 持久化键（带版本号：形状变了就换键，不去猜旧数据怎么迁）。
 *
 * `runId` 是**追加的可选字段**而不是换键的理由：老数据没有它，读回来时按「未标记
 * 启动」处理（见 `asMessageRecord`），换键反而会让用户**丢掉全部历史消息**——
 * 而这个面板记的正是故障，丢历史等于把唯一的留底抹掉。 */
export const MESSAGE_CENTER_STORAGE_KEY = "comfyapp:message-center:v1";

const MESSAGE_KINDS: ReadonlyArray<MessageKind> = ["update", "restart", "offline", "info"];

/** 一条记录是否可用（字段齐、类型对、kind 认识）。
 *
 * `runId` **容忍缺席**（升级前写入的历史消息没有这个字段）：缺了就按 null 处理，
 * 于是那些消息落到「未标记启动」那一组——不猜它属于哪一次，也不因此丢掉整条。 */
function asMessageRecord(raw: unknown): MessageRecord | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  /* SAFETY: 类型断言已复核 */
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") {
    return null;
  }
  if (typeof o.title !== "string" || typeof o.body !== "string") {
    return null;
  }
  if (typeof o.time !== "number" || !Number.isFinite(o.time)) {
    return null;
  }
  if (typeof o.read !== "boolean") {
    return null;
  }
  if (
    typeof o.kind !== "string" ||
    /* SAFETY: 类型断言已复核 */
    !MESSAGE_KINDS.includes(o.kind as MessageKind)
  ) {
    return null;
  }
  return {
    id: o.id,
    /* SAFETY: 类型断言已复核 */
    kind: o.kind as MessageKind,
    title: o.title,
    body: o.body,
    time: o.time,
    read: o.read,
    runId: typeof o.runId === "string" && o.runId ? o.runId : null,
  };
}

/** 从持久化里读回消息；没存过 / 存坏了 / 没有任何一条可用 → 空数组。 */
function readPersistedMessages(): Array<MessageRecord> {
  const raw = readStorageJson<unknown>(MESSAGE_CENTER_STORAGE_KEY, null);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(asMessageRecord)
    .filter((m): m is MessageRecord => m !== null)
    .slice(0, MAX_MESSAGES);
}

/** 当前内存里的消息是否已经等于持久化里那一份（避免恢复时空跑一次渲染）。
 *  `runId` 也参与比较：它是分组键，内存里盖了戳而持久化里没有时若不换引用，
 *  刷新一次就会丢掉分组依据。 */
function sameAsPersisted(current: Array<MessageRecord>): boolean {
  const persisted = readPersistedMessages();
  if (persisted.length !== current.length) {
    return false;
  }
  return persisted.every((m, i) => {
    const c = current[i];
    return (
      c?.id === m.id &&
      c.read === m.read &&
      c.title === m.title &&
      c.body === m.body &&
      c.runId === m.runId
    );
  });
}

/** 恢复：与当前内容相同就原样返回（不给 store 塞一份等值的新数组）。 */
function restoreMessages(current: Array<MessageRecord>): Array<MessageRecord> {
  return sameAsPersisted(current) ? current : readPersistedMessages();
}

useMessageCenterStore.subscribe((state, prev) => {
  /* 只在 `messages` 换了引用时写：开关面板 / 标记已读之外的动作不该碰存储。 */
  if (state.messages !== prev.messages) {
    writeStorageJson(MESSAGE_CENTER_STORAGE_KEY, state.messages);
  }
});
