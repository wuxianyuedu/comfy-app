"use client";

/**
 * 设置页「启动日志」的数据层（规范 17 §17.2 第②层）：三个分区此前各写一份同款实现，这里收成一处。
 * 数据来自 `GET /api/logs/sessions`（一次启动一份文件，ISSUE #1326），一次请求拿到列表与正文。
 * 挂载/切换/刷新重新取，`active` 时每秒跟随；轮询回调只读 ref 里的选中项，不重建定时器。
 *
 * **增量口径（ISSUE #4558）**：活跃期每秒拉回的正文最长 400KB，此前每轮对全文做
 * `replaceAll(CR)` + 全文重解析并整体 setState —— 三来源同挂时每秒最多 1.2 万个
 * span 的重协调。现在：
 *   · 正文与前一轮**逐字相同** → 整块复用上一份 snapshot 引用（setState 传同引用，
 *     React 直接跳过渲染）——「文件没变的秒」零解析零渲染；
 *   · 正文是上一轮的**前缀延伸**（只追加了新输出）→ 只把新增尾巴喂给流式解析器
 *     （`createAnsiSegmentParser`，SGR 状态跨轮延续，与全文解析逐段等价），片段数组
 *     只追加不改写 —— 旧片段引用稳定，渲染协调只落在新增部分；
 *   · 前缀失配（服务端尾窗滑动掐头 / 换了会话）→ 重建解析器对全文重扫（与旧行为相同）。
 * 自定义 `parse`（Ollama 的 logrus 语义上色）不参与流式增量：正文无变化时同样复用
 * 引用跳过渲染，有变化时全量解析（与旧行为同成本）。
 *
 * 页面不可见的暂停**已在场**：`useInterval` 默认 `pauseWhenHidden`（切后台/最小化
 * 不发请求、回前台补跑一次）——本 hook 的轮询走的就是它。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { tailWindow } from "~/lib/page-window";
import { useInterval } from "~/components/ui/use-interval";

import { createAnsiSegmentParser, parseAnsiSegments, type AnsiSegment } from "~/lib/log/log-ansi";
import { fetchLogSessions, type RuntimeLogSourceKind } from "~/lib/log/log-file-client";
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

export type RuntimeLogSourceState = {
  /** 重新拉取当前会话（「刷新」按钮）。 */
  refresh: () => Promise<void>;
  /** 正文解析出的带样式片段（视图只渲染它）。 */
  segments: Array<AnsiSegment>;
  /** 切到指定会话并立即重新拉取。 */
  selectSession: (id: string) => void;
  /** 当前选中会话的 id；没有日志文件时为 null。 */
  sessionId: string | null;
  /** 可切换的会话（**新→旧，第一项就是最新**）；不足两条时界面不显示下拉。 */
  sessions: Array<LogSessionMeta>;
  /** 选中会话的正文（已去掉 `\r`）。 */
  text: string;
  /**
   * 这个来源一共有几份启动日志（不受下拉上限影响）。
   * 界面据此说明「更早的启动不在列表里」（硬规则 4）；一次启动一份文件后同一天可能
   * 攒几十份，不说的话用户会以为只启动过这些次。
   */
  total: number;
  /** 选中那一份的正文被服务端截断（界面提示「只看得到最近一段」）。 */
  truncated: boolean;
  /** 该份日志过大、服务端只扫了尾部窗口（界面提示「这次启动只显示了一段」）。 */
  windowed: boolean;
};

/** 视图消费的日志来源：来源状态 + 「是否正在跟随本次启动」（由 controller 给）。 */
export type RuntimeLogController = RuntimeLogSourceState & { active: boolean };

type Snapshot = {
  segments: Array<AnsiSegment>;
  sessionId: string | null;
  sessions: Array<LogSessionMeta>;
  text: string;
  total: number;
  truncated: boolean;
  windowed: boolean;
};

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
function capSegments(segments: Array<AnsiSegment>): Array<AnsiSegment> {
  return tailWindow(segments, MAX_SEGMENTS);
}

/** 上一轮解析的留存：前缀复用与增量解析的基线。 */
type ParsedBaseline = {
  /** 上一轮的完整正文（已剥 `\r`）。 */
  fullText: string;
  /** 上一轮的显示片段（已按 {@link MAX_SEGMENTS} 截尾）。 */
  segments: Array<AnsiSegment>;
  /**
   * 流式解析器（状态跨轮延续）；仅默认 ANSI 解析档给 —— 自定义 `parse`
   * （Ollama 的 logrus 上色）语义无法流式续接，为 null。
   */
  stream: ((tail: string) => Array<AnsiSegment>) | null;
};

export type RuntimeLogSourceOptions = {
  /** 正在启动：每秒跟随该次启动的新增输出；否则只在挂载 / 切换 / 刷新时取一次。 */
  active: boolean;
  /**
   * 正文 → 渲染片段的解析器。**传模块级常量函数**（`parseAnsiSegments` /
   * `parseOllamaLogText`）：它进 effect 依赖，内联箭头函数会让定时器每次渲染
   * 重建。
   */
  parse?: (text: string) => Array<AnsiSegment>;
  source: RuntimeLogSourceKind;
};

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
  /* 卸载判活（ISSUE #4288）：在途拉取回来时组件可能已卸载，不再整块写入
   * 已消失的界面状态（seq 只防「旧盖新」，不防「卸载后写」）。 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  /* 上一轮解析留存：正文前缀复用与增量解析的基线（见文件头的增量口径）。
   * 切换 / 刷新 / 窗口滑动导致正文不再是上一轮的前缀时，从这里整块重建。 */
  const parsedRef = useRef<ParsedBaseline | null>(null);

  const pull = useCallback(async () => {
    const seq = (seqRef.current += 1);
    let slice = await fetchLogSessions(source, sessionRef.current);
    if (slice && seq === seqRef.current) {
      /* 新的一次启动出现 → 自动切到最新（不能停在旧会话等用户手换下拉）。
       * 判据用会话开始时刻（`latestStartedAtRef`）；已在最新则不动。
       * `sessions` 按新→旧排列是 `GET /api/logs/sessions` 的契约，取错一端会让自动跟随停在最旧那份。 */
      const latest = slice.sessions[0] ?? null;
      const isNewStart =
        latest !== null &&
        latest.startedAt !== null &&
        latest.startedAt !== latestStartedAtRef.current;
      if (isNewStart) {
        latestStartedAtRef.current = latest.startedAt;
      }
      if (isNewStart && slice.selectedId !== latest.id) {
        /* 切过去并在同一次调用里把新会话的正文取回来（不走递归：
         * useCallback 的自引用过不了 react-hooks 的静态检查）。 */
        sessionRef.current = latest.id;
        slice = await fetchLogSessions(source, latest.id);
      }
    }
    if (!slice || seq !== seqRef.current) {
      return;
    }
    /* 服务端回落的选中项（请求的 id 已不在列表里时它会选最新）：以它为准。 */
    sessionRef.current = slice.selectedId;
    const text = slice.content.replaceAll(CR_RE, "");
    if (!aliveRef.current) {
      return;
    }
    /* ── 增量口径（ISSUE #4558）：只解析「变了的那个部分」────────────── */
    const prev = parsedRef.current;
    /* 默认 ANSI 解析档才有流式形态（状态跨轮延续）；自定义 parse 不参与。 */
    const streaming = parse === parseAnsiSegments;
    let segments: Array<AnsiSegment> | undefined;
    let nextStream: ((tail: string) => Array<AnsiSegment>) | null = null;
    if (prev !== null) {
      if (text === prev.fullText) {
        /* 正文没变：整块复用旧引用。setState 收到与当前 state 相同的引用时
         * React 直接跳过重渲 —— 「文件没变的秒」零解析零渲染。 */
        segments = prev.segments;
        nextStream = prev.stream;
      } else if (prev.stream !== null && text.startsWith(prev.fullText)) {
        /* 只追加了新输出：新增尾巴交给流式解析器（SGR 状态跨轮延续，与全文
         * 解析逐段等价）；旧片段引用原样保留，渲染协调只落在新增部分。 */
        const tail = text.slice(prev.fullText.length);
        segments = capSegments([...prev.segments, ...prev.stream(tail)]);
        nextStream = prev.stream;
      }
    }
    if (segments === undefined) {
      /* 首轮 / 换会话 / 服务端尾窗滑动（掐头后前缀失配）：对全文重扫。
       * 流式档在这里**重建**解析器 —— 它的状态必须从这份正文的零点重新
       * 推进（旧状态属于上一份文本，续用会把颜色带进新会话）。 */
      nextStream = streaming ? createAnsiSegmentParser() : null;
      segments = capSegments(nextStream === null ? parse(text) : nextStream(text));
    }
    parsedRef.current = { fullText: text, segments, stream: nextStream };
    setSnapshot({
      text,
      segments,
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
