"use client";

/* ── 应用内「消息中心」共享状态（状态 + 持久化，无 React、无网络）────────────
 * 承载「只看一次就消失」的系统级提示（更新需重启、dev server 重启、应用服务
 * 断开与启动等）：状态栏铃铛 + 未读数，点开全屏看正文。
 * 本文件只定义状态与动作；生产（谁触发 push）与展示在组件层接入（规范 17）。
 */

import { create } from "zustand";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import { isPlainRecord } from "~/lib/is-record";
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
   * 面板按它分组（判据见 `~/lib/shell/message-run-groups`）：多次启动的记录混在一起
   * 时分不清哪几条属于同一次故障。与 `run/runs/<…>-<runId>` 的 runId 同源。
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
   * 断开那条要先把原因从盘上读回来（壳的 IPC），push 比事件晚一个往返；一律取
   * push 时刻的话「断开 → 恢复」的先后取决于往返快慢——列表按 `time` 倒序排。
   */
  time?: number;
};

export type MessageCenterState = {
  /** 清空所有消息 */
  clear: () => void;
  /**
   * 当前是哪一次启动（运行时事实，**不持久化**）。
   * 由探活链路学到 runId 时写入（`use-app-service-message-log` → 本 store）：
   * ① 面板高亮「本次启动」组；② `push` 缺省 runId 时盖它，生产方自动按启动分组。
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
          /* runId **没给**时盖「当前这一次启动」：生产方不必各自去接探活链路，
           * 也不会漏盖（漏盖只能落到「未标记启动」组）。
           * 判 `=== undefined` 而不是 `??`：显式给的 null 是「明确不知道」（纯手工
           * `pnpm dev`、探活未首答），必须留 null；`??` 补盖等于断言「属于这次」，
           * 分组依据就错了。 */
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
 * 记的恰恰是应用服务断开/启动这类事件，观察窗口覆盖整页刷新，内存归零就看不到了；
 * 落 localStorage 留底。恢复走 `hydrate()` 而非模块加载时读：模块加载发生在首帧
 * 渲染前，SSR「无角标」与客户端首帧对不上（水合不匹配）；`hydrate()` 挂载后才调。
 * 读回逐条校验：坏数据必须落到「没有消息」，而不是抛错让面板整个打不开。 */

/** 持久化键（带版本号：形状变了就换键，不去猜旧数据怎么迁）。
 *
 * `runId` 是**追加的可选字段**而不是换键的理由：老数据没有它，读回来时按「未标记
 * 启动」处理（见 `asMessageRecord`），换键反而会让用户**丢掉全部历史消息**——
 * 而这个面板记的正是故障，丢历史等于把唯一的留底抹掉。 */
export const MESSAGE_CENTER_STORAGE_KEY = "comfyapp:message-center:v1";

const MESSAGE_KINDS: ReadonlyArray<MessageKind> = ["update", "restart", "offline", "info"];

/** 只认白名单里的档位；持久化里的 kind 是外部输入，先收窄再采用。 */
function isMessageKind(v: unknown): v is MessageKind {
  return typeof v === "string" && MESSAGE_KINDS.some((kind) => kind === v);
}

/** 一条记录是否可用（字段齐、类型对、kind 认识）。
 *
 * `runId` **容忍缺席**（升级前写入的历史消息没有这个字段）：缺了就按 null 处理，
 * 于是那些消息落到「未标记启动」那一组——不猜它属于哪一次，也不因此丢掉整条。 */
function asMessageRecord(raw: unknown): MessageRecord | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const o = raw;
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
  if (!isMessageKind(o.kind)) {
    return null;
  }
  return {
    id: o.id,
    kind: o.kind,
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
