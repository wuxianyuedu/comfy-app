"use client";

/**
 * 设置页「Ollama 本地模型服务」分区的 sub-hook（`use-settings-page` 的拆分件）。
 *
 * 收口：状态行的 `status` / 候选 `models` / 进行态 `starting` 与 `stopping`、
 * 两个探测函数（`probeOllama` / `probeOllamaSilent`）、拉起（`startOllama`：
 * POST 后按 `OLLAMA_READY` 的退避轮询等就绪，冷启动远不止 2s——过去固定睡 2s
 * 会让状态行回到「未运行」、按钮恢复可点、用户连点就会拉起多个 serve 进程抢
 * 11434 端口）、关闭（`stopOllama`：终止进程树 + 重探一次）、运行时日志的
 * active 判据、以及「provider 是本地 & baseUrl 已填」的挂载 / 切换 effect。
 *
 * 两段进行态都各配一把 ref（`startingRef` / `stoppingRef`）：轮询与关闭是
 * **异步跨事件循环**的，state 值在事件循环里判不出；探测在启动 / 关闭进行
 * 期间不得覆盖状态行，靠 ref 挡住。
 *
 * baseUrl 与 provider 是否本地由主 hook 从 llmDraft 里取出后传入；sub-hook
 * 不碰 llmDraft 的编辑与持久化——那是主 hook 的边界。
 *
 * Ollama 这一整块与 Comfy / DbStudio **不共享 state**（三条服务各自的
 * status/start/stop 都是独立的）。返回形状与主 hook 控制器逐字段一致，
 * 视图与测试都不感知——§12.18 复用优先。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { parseOllamaLogText } from "~/lib/log/log-ansi";
import {
  probeOllama as probeOllamaClient,
  startOllama as startOllamaClient,
  stopOllama as stopOllamaClient,
  type OllamaModel,
} from "~/lib/llm/ollama-client";
import { OLLAMA_READY } from "~/lib/retry-policy";
import { sleep } from "~/lib/with-timeout";
import {
  useRuntimeLogSource,
  type RuntimeLogController,
} from "./use-runtime-log-source";
import type { OllamaStatus } from "./use-settings-page-types";

/** 拉起后轮询的次数与间隔：直接沿用 `OLLAMA_READY` 的退避表（同 retry-policy 一处口径）。 */
const OLLAMA_START_POLL_TIMES = OLLAMA_READY.maxAttempts;
const OLLAMA_START_POLL_INTERVAL_MS = OLLAMA_READY.baseMs;

export interface UseSettingsOllama {
  ollamaStatus: OllamaStatus;
  ollamaModels: OllamaModel[];
  ollamaStarting: boolean;
  ollamaStopping: boolean;
  ollamaLog: RuntimeLogController & { active: boolean };
  startOllama: () => Promise<void>;
  stopOllama: () => Promise<void>;
}

export function useSettingsOllama({
  llmBaseUrl,
  providerIsLocal,
  showFlash,
}: {
  /** 从 llmDraft 里取出的 baseUrl；空串代表「未填」。 */
  llmBaseUrl: string;
  /** 当前 provider 是否是本地（远端 provider 下无需探测）。 */
  providerIsLocal: boolean;
  /** 整页提示条通道。 */
  showFlash: ActionReport;
}): UseSettingsOllama {
  const [status, setStatus] = useState<OllamaStatus>("checking");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  /* 启动 / 关闭流程期间状态行的持有权标记：launch / stop 会自己落「启动中 /
   * 运行中 / 未运行」，期间挂载触发的探测不得覆盖（否则 UI 会跳变——轮询
   * 探测本身不发「checking」+ 静默写结果，但 baseUrl 等其它 effect 仍可能
   * 并发探测）。关闭动作（终止进程树 + 等端口释放）最长可挂 5s，其间探测
   * 会把状态行抢回「未运行」并重开「关闭 Ollama」按钮（同 #103 的
   * 「操作后状态被覆盖」族问题）。 */
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);

  /** 静默探测：不发「检测中」、不与其他探测互相覆盖状态。 */
  const probeOllamaSilent = useCallback(async (baseUrl: string) => {
    const result = await probeOllamaClient(baseUrl);
    if (startingRef.current || stoppingRef.current) return;
    if (result.up) {
      setModels(result.models);
      setStatus("up");
      return;
    }
    setModels([]);
    setStatus("down");
  }, []);

  /** 探测并把结果落到状态行。启动流程内部轮询禁用此函数（见 probeOllamaSilent）。 */
  const probeOllama = useCallback(
    async (baseUrl: string) => {
      if (startingRef.current || stoppingRef.current) return;
      setStatus("checking");
      await probeOllamaSilent(baseUrl);
    },
    [probeOllamaSilent],
  );

  // baseUrl 变化或本地 provider 切换时重新探测。
  // 只有「本地 provider + 已填 baseUrl」才有得探测；否则说明当前没有可探测的
  // Ollama（provider 是远端、或还没填地址），若仍停留在初始 / 遗留的 checking
  // 态，状态行会一直「检测 Ollama 服务…」转圈永不结束——这里落定为 down。
  useEffect(() => {
    if (!providerIsLocal || !llmBaseUrl) {
      const settle = setTimeout(() => {
        setStatus((prev) => (prev === "checking" ? "down" : prev));
      }, 0);
      return () => clearTimeout(settle);
    }
    const timer = setTimeout(() => void probeOllama(llmBaseUrl), 0);
    return () => clearTimeout(timer);
  }, [providerIsLocal, llmBaseUrl, probeOllama]);

  const startOllama = useCallback(async () => {
    setStarting(true);
    startingRef.current = true;
    setStatus("starting");
    /* 「拉起 → 轮询等就绪 → 超时抛错」整段交给出口报成败：失败路径的文案
     *（含超时那句自带可执行动作的说明）走 `errorMessage`，成功静默
     *（状态行自己会变成「已运行」，是这条账里唯一不需要额外说一句的落点）。 */
    const result = await (async () => {
      try {
        return await runAsyncAction(
          async () => {
            await startOllamaClient();
            // 轮询等就绪再交回控制权：期间保持「启动中…」按钮禁用。
            for (let i = 0; i < OLLAMA_START_POLL_TIMES; i++) {
              if (llmBaseUrl) {
                const probe = await probeOllamaClient(llmBaseUrl);
                if (probe.up) {
                  setModels(probe.models);
                  setStatus("up");
                  return;
                }
              }
              await sleep(OLLAMA_START_POLL_INTERVAL_MS);
            }
            throw new Error(
              "Ollama 启动超时：进程可能未成功运行，请确认已安装 Ollama 并可手动执行 ollama serve",
            );
          },
          { report: showFlash, failureText: "启动 Ollama 失败" },
        );
      } finally {
        setStarting(false);
        startingRef.current = false;
      }
    })();
    // 超时 / 失败后兜底探一次，让状态行和进程的真实情况对齐
    if (!result.ok && llmBaseUrl) await probeOllamaSilent(llmBaseUrl);
  }, [llmBaseUrl, probeOllamaSilent, showFlash]);

  const stopOllama = useCallback(async () => {
    setStopping(true);
    stoppingRef.current = true;
    /* 「停止 → 重新探测」两段都跑（无论成败状态行都要对齐），
     * 所以探测不进 `action` —— 它在 finally 的语义上，不在成功分支上。 */
    try {
      await runAsyncAction(() => stopOllamaClient(), {
        report: showFlash,
        failureText: "关闭 Ollama 失败",
        successText: "Ollama 已关闭",
      });
    } finally {
      setStopping(false);
      stoppingRef.current = false;
    }
    // 停止后重新探测，状态行回到「未运行」
    if (llmBaseUrl) await probeOllama(llmBaseUrl);
  }, [llmBaseUrl, probeOllama, showFlash]);

  const logActive = starting || status === "starting";
  const log = useRuntimeLogSource({
    source: "ollama-runtime",
    active: logActive,
    /* Ollama 落盘的是 logrus 纯文本（无 ANSI 码），按 level= 语义上色 */
    parse: parseOllamaLogText,
  });

  return {
    ollamaStatus: status,
    ollamaModels: models,
    ollamaStarting: starting,
    ollamaStopping: stopping,
    ollamaLog: { ...log, active: logActive },
    startOllama,
    stopOllama,
  };
}
