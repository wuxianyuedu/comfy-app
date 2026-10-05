"use client";

/**
 * 设置页「启动日志」的数据层（规范 17 §17.2 第②层）。
 *
 * 三个分区（ComfyUI / Drizzle Studio / Ollama）此前各写了一份「取文件尾部 →
 * 追加 / 替换 → 解析 ANSI → 启动期间每秒轮询」的实现，只有来源与解析器不同
 * （判据见规范 12 §12.12：跨文件复制的同一段逻辑会各自漂移）。这里收成一处：
 *
 *   - 数据来自 `GET /api/logs/sessions`（按**每一次启动**列文件，判据见
 *     `lib/log/runtime-log-file`），一次请求同时拿到**启动列表**与**选中那一次的
 *     正文** —— 界面因此能提供「切到哪一次启动」的下拉，而不用把整份日志读进
 *     浏览器。那四份 runtime 日志现在是**一次启动一份文件**（ISSUE #1326）：
 *   - 挂载、切换会话、点「刷新」都会重新取一次；`active`（正在启动）时每秒跟随；
 *     ComfyUI 被重启三次就有三份文件，切过去看的是**那一份整份**，不再需要任何
 *     切分判据；
 *   - 轮询回调只读 ref 里的选中项，不因用户切换下拉而重建定时器。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { tailWindow } from "~/lib/page-window";
import { useInterval } from "~/components/ui/use-interval";

import { parseAnsiSegments, type AnsiSegment } from "~/lib/log/log-ansi";
import {
  fetchLogSessions,
  type RuntimeLogSourceKind,
} from "~/lib/log/log-file-client";
import type { LogSessionMeta } from "~/lib/log/log-sessions";

/** 跟随轮询间隔：与启动过程的可观测性要求一致（秒级）。 */
const POLL_MS = 1000;

/**
 * 渲染片段上限：一次超长会话（「保活」模式可能累积几小时输出）不至于把
 * 几千个 span 一次性挂进 DOM。正文本身的大小由服务端上限兜住。
 */
const MAX_SEGMENTS = 4000;

/** `\r`（Windows 行尾）在日志面板里只添乱；SGR 颜色序列保留给视图层渲染。 */
const CR_RE = /\r/g;

export interface RuntimeLogSourceState {
  /** 选中会话的正文（已去掉 `\r`）。 */
  text: string;
  /** 正文解析出的带样式片段（视图只渲染它）。 */
  segments: AnsiSegment[];
  /** 可切换的会话（新→旧，最后一项是本次启动）；不足两条时界面不显示下拉。 */
  sessions: LogSessionMeta[];
  /** 当前选中会话的 id；没有日志文件时为 null。 */
  sessionId: string | null;
  /** 选中那一份的正文被服务端截断（界面提示「只看得到最近一段」）。 */
  truncated: boolean;
  /** 该份日志过大、服务端只扫了尾部窗口（界面提示「这次启动只显示了一段」）。 */
  windowed: boolean;
  /**
   * 这个来源一共有几份启动日志（不受下拉上限影响）。
   *
   * 界面据此说明「更早的启动不在列表里」（硬规则 4：必须有用户可见出口）——
   * 一次启动一份文件之后，同一天可能攒几十份，不说的话用户会以为「只启动过这些次」。
   */
  total: number;
  /** 切到指定会话并立即重新拉取。 */
  selectSession: (id: string) => void;
  /** 重新拉取当前会话（「刷新」按钮）。 */
  refresh: () => Promise<void>;
}

/** 视图消费的日志来源：来源状态 + 「是否正在跟随本次启动」（由 controller 给）。 */
export type RuntimeLogController = RuntimeLogSourceState & { active: boolean };

interface Snapshot {
  text: string;
  segments: AnsiSegment[];
  sessions: LogSessionMeta[];
  sessionId: string | null;
  truncated: boolean;
  windowed: boolean;
  total: number;
}

const EMPTY_SNAPSHOT: Snapshot = {
  text: "",
  segments: [],
  sessions: [],
  sessionId: null,
  truncated: false,
  windowed: false,
  total: 0,
};

/** 解析结果按上限取尾部（与「只看最新一段」的口径一致）。 */
function capSegments(segments: AnsiSegment[]): AnsiSegment[] {
  return tailWindow(segments, MAX_SEGMENTS);
}

export interface RuntimeLogSourceOptions {
  source: RuntimeLogSourceKind;
  /** 正在启动：每秒跟随该次启动的新增输出；否则只在挂载 / 切换 / 刷新时取一次。 */
  active: boolean;
  /**
   * 正文 → 渲染片段的解析器。**传模块级常量函数**（`parseAnsiSegments` /
   * `parseOllamaLogText`）：它进 effect 依赖，内联箭头函数会让定时器每次渲染
   * 重建。
   */
  parse?: (text: string) => AnsiSegment[];
}

export function useRuntimeLogSource({
  source,
  active,
  parse = parseAnsiSegments,
}: RuntimeLogSourceOptions): RuntimeLogSourceState {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  /* 选中的会话放在 ref：轮询回调要读它，但不该因「用户切换下拉」重建定时器。 */
  const sessionRef = useRef<string | null>(null);
  /* 见过的最新会话开始时刻：会话 id 是「起点行号」，日志文件一超尾窗、行号
   * 就整体平移，拿 id 判「新会话」会误判；开始时刻（行内时刻，跨窗口滑动
   * 稳定）才是新启动的可靠标记。 */
  const latestStartedAtRef = useRef<number | null>(null);
  /* 在途请求序号：切换 / 刷新与轮询可能重叠，只认最后一次的响应 ——
   * 否则后到的旧响应会把用户刚切过去的会话顶回去。 */
  const seqRef = useRef(0);

  const pull = useCallback(async () => {
    const seq = (seqRef.current += 1);
    let slice = await fetchLogSessions(source, sessionRef.current);
    if (slice && seq === seqRef.current) {
      /* 新的一次启动出现 → 自动切到最新（用户预期是「启动后自动看最新日志」，
       * 不能停在旧会话里等他手动换下拉）。判据用会话开始时刻而不是行号 id
       * （见 latestStartedAtRef）；正在展示的已是最新则不用动。 */
      const latest = slice.sessions[slice.sessions.length - 1] ?? null;
      const isNewStart =
        latest !== null &&
        latest.startedAt !== null &&
        latest.startedAt !== latestStartedAtRef.current;
      if (isNewStart) latestStartedAtRef.current = latest.startedAt;
      if (isNewStart && slice.selectedId !== latest.id) {
        /* 切过去并在同一次调用里把新会话的正文取回来（不走递归：
         * useCallback 的自引用过不了 react-hooks 的静态检查）。 */
        sessionRef.current = latest.id;
        slice = await fetchLogSessions(source, latest.id);
      }
    }
    if (!slice || seq !== seqRef.current) return;
    /* 服务端回落的选中项（请求的 id 已不在列表里时它会选最新）：以它为准。 */
    sessionRef.current = slice.selectedId;
    const text = slice.content.replace(CR_RE, "");
    setSnapshot({
      text,
      segments: capSegments(parse(text)),
      sessions: slice.sessions,
      sessionId: slice.selectedId,
      truncated: slice.truncated,
      windowed: slice.windowed,
      total: slice.total,
    });
  }, [source, parse]);

  /* 挂载 / 换来源先取一次（未启动时也要能看到最近一次启动的日志），
   * 之后按 `active` 开关轮询（规范 16 §16.2.4.15）。`pull` 变化时要重跑一次
   * —— `useInterval` 的 `ms` 变化会重建定时器并补跑，但「换来源」不一定改变
   * `active`，所以那次首取仍显式保留。 */
  useEffect(() => {
    void pull();
  }, [pull]);

  useInterval(pull, { ms: active ? POLL_MS : null });

  const selectSession = useCallback(
    (id: string) => {
      sessionRef.current = id;
      void pull();
    },
    [pull],
  );

  return { ...snapshot, selectSession, refresh: pull };
}
