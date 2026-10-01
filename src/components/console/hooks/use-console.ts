"use client";

// ── 应用内控制台 · 第②层（查询与动作编排）───────────────────────────────────
//
// 视图只渲染（规范 17 §17.2）：SSE 的发起、逐帧累积、中止、历史回看都在这里，
// 视图拿到的是「已经算好文案的输出 + 一个状态机」。
//
// 状态机的四个值（这是本控制器真正要回答的问题）：
//   idle      没有命令在跑，也没跑过（首次打开）
//   running   有一条正在跑（输出在长）
//   done      跑完了，带退出码（成功 / 失败由 code 判，界面文案不同）
//   stopped   被用户中止（**不是失败**：用户自己按的停止，不该看到红色报错）
//
// 为什么不让视图自己拿布尔拼：这四态对应四种**不同的下一步动作**（能输入 /
// 能停止 / 能重跑 / 能清屏），拼布尔迟到会出现「跑完了还能点停止」或
// 「停止了显示成失败」——这类错没有任何报错会告诉你。
//
// **一条命令只有一条起跑路径**（下面的 `startRun`）：`run` / `rerun` 只差
// 「命令行从哪来」。此前两组各写一份逐帧处理，改一处判据必然漏另一处
// （§12.12 的孪生对教训）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clampOutput,
  runConsoleCommand,
  type ConsoleClientEvent,
} from "~/lib/console/console-client";
import { shellSyntaxWarning } from "~/lib/console/console-catalog";
import { MAX_COMMAND_CHARS } from "~/lib/console/console-limits";
import { MAX_HISTORY_ENTRIES } from "~/lib/console/console-limits";
import { fixed } from "~/lib/number-format";

/** 一条**已跑过**的命令（本次会话的历史；只在内存里）。 */
export interface ConsoleHistoryItem {
  command: string;
  /** 结果文案（判据在控制器，视图不重算）。 */
  verdict: string;
  ok: boolean;
  durationMs: number;
}

export type ConsolePhase = "idle" | "running" | "done" | "stopped";

export interface ConsoleController {
  /** 输入框内容（受控）。 */
  command: string;
  setCommand: (next: string) => void;
  phase: ConsolePhase;
  /** 输出正文（stdout 与 stderr 合并按到达顺序，与真实终端一致）。 */
  output: string;
  /** 正在跑的那条命令；null = 没有在跑。 */
  runningCommand: string | null;
  /** 跑完那条的退出码；null = 没拿到（起不来 / 被掐）。 */
  exitCode: number | null;
  /** 结论摘要（一行，直接渲染）。 */
  verdict: string;
  /** 结论是否为「成功」（决定颜色）。 */
  verdictOk: boolean;
  /** 本次会话跑过的命令（新的在前）。 */
  history: ConsoleHistoryItem[];
  /** 命令是否可提交（非空 + 没在跑 + 不超长）。 */
  canRun: boolean;
  /** 输入框的字符上限（与路由同一常量，界面与服务端不会各说各话）。 */
  maxCommandChars: number;
  /**
   * 「这行里有会被误当成 shell 语法的东西」的提示；null = 没有。
   *
   * 界面在输入框下方原样展示它：`a && b` 会被静默当成「只跑 a」，而退出码可能
   * 还是 0 —— 不提示的话用户只会看到「跑过了」，不会知道少了一半
   * （`shellSyntaxWarning` 的文件头记了实测量到的现象）。
   */
  syntaxWarning: string | null;
  /** 提交当前输入框里的命令。 */
  run: () => void;
  /** 停止正在跑的命令（杀整棵树）。 */
  stop: () => void;
  /** 清空输出与结论（保留历史）。 */
  clear: () => void;
  /** 填入一条命令（**不直接跑**：用户还能改参数）。 */
  fill: (command: string) => void;
}

/** 用时的人话（<1s 给毫秒、<60s 给秒、再往上给分秒）。
 *
 *  秒那档保留一位小数走 `~/lib/number-format` 的 `fixed`（全库唯一精度出口）：
 *  手写 `toFixed` 会在不同落点给出不同的尾零口径（这里一位、别处两位），
 *  而「同一条命令在两处显示不同用时」是没人会去查的静默不一致。 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${fixed(ms / 1000, 1) ?? "0.0"}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec}s`;
}

export function useConsole(): ConsoleController {
  const [command, setCommand] = useState("");
  const [phase, setPhase] = useState<ConsolePhase>("idle");
  const [output, setOutput] = useState("");
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [verdict, setVerdict] = useState("");
  const [verdictOk, setVerdictOk] = useState(false);
  const [history, setHistory] = useState<ConsoleHistoryItem[]>([]);

  /** 在飞请求的中止控制器：`stop()` 与卸载都经它断开（断开 = 服务端回收命令）。 */
  const abortRef = useRef<AbortController | null>(null);
  /** 卸载后不再 setState（切视图 / 关面板时命令还在跑的窗口）。 */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const append = useCallback((text: string) => {
    setOutput((prev) => clampOutput(prev + text));
  }, []);

  /**
   * 起一条命令 —— **唯一的起跑路径**（`run` / `rerun` 只是它的两个入口）。
   *
   * 逐帧处理收在这里，是因为「收到 exit 帧该做什么」有六件事必须同一处做：
   * 记退出码、定状态机、算结论文案、定颜色、追加退出行、记历史。分开写就会
   * 出现「重跑那次没记历史」这种没人会发现的缺口。
   */
  const startRun = useCallback(
    (line: string) => {
      if (abortRef.current) return; // 已经有一条在跑
      setOutput("");
      setExitCode(null);
      setVerdict("");
      setRunningCommand(line);
      setPhase("running");

      const controller = new AbortController();
      abortRef.current = controller;
      /** 服务端回显的命令行（最终以它为准记历史，与真实执行的那条对齐）。 */
      let echoed = line;
      let sawExit = false;

      const finish = (item: ConsoleHistoryItem) => {
        setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY_ENTRIES));
      };

      void runConsoleCommand({
        command: line,
        signal: controller.signal,
        onEvent: (event: ConsoleClientEvent) => {
          if (!aliveRef.current) return;
          if (event.type === "start") {
            echoed = event.command || line;
            append(`$ ${echoed}\n`);
            return;
          }
          if (event.type === "out") {
            append(event.text);
            return;
          }
          if (event.type === "error") {
            append(`\n${event.message}\n`);
            return;
          }
          // exit：唯一改动状态机的帧。
          sawExit = true;
          setExitCode(event.code);
          if (event.killed) {
            setPhase("stopped");
            setVerdict(
              `已停止（用时 ${formatDuration(event.durationMs)}）—— 命令及其子进程已回收`,
            );
            setVerdictOk(false);
          } else if (event.code === 0) {
            setPhase("done");
            setVerdict(
              `完成（退出码 0，用时 ${formatDuration(event.durationMs)}）`,
            );
            setVerdictOk(true);
          } else {
            setPhase("done");
            setVerdict(
              `失败（退出码 ${event.code ?? "未知"}，用时 ${formatDuration(event.durationMs)}）`,
            );
            setVerdictOk(false);
          }
          if (event.truncatedNote) append(`\n${event.truncatedNote}\n`);
          append(`\n[进程已退出，退出码 ${event.code ?? "未知"}]\n`);
          finish({
            command: echoed,
            verdict: event.killed
              ? "已停止"
              : event.code === 0
                ? "成功"
                : `失败（${event.code ?? "未知"}）`,
            ok: !event.killed && event.code === 0,
            durationMs: event.durationMs,
          });
        },
      }).then((outcome) => {
        if (!aliveRef.current) return;
        abortRef.current = null;
        setRunningCommand(null);
        if (outcome.kind === "ok") {
          /* 流正常结束但 `exit` 帧没来（服务端异常关闭）：必须在这里收口，
           * 否则界面永远停在「正在运行」——最难查的一种「卡住」。 */
          if (!sawExit) {
            setPhase("done");
            setVerdict("命令已结束（未收到退出码）");
            setVerdictOk(false);
          }
          return;
        }
        if (outcome.kind === "aborted") {
          // 「已停止」的文案与状态多数已由 exit 帧给过；这里只补没收到的那次。
          if (!sawExit) {
            setPhase("stopped");
            setVerdict("已停止 —— 命令及其子进程已回收");
            setVerdictOk(false);
          }
          return;
        }
        // rejected（403 / 401 / 400 / 409）与 failed：都是**用户能修**的一句话，
        // 原样展示（它比「执行失败」有用得多）。
        setPhase("done");
        setVerdict(outcome.reason);
        setVerdictOk(false);
        append(`\n${outcome.reason}\n`);
      });
    },
    [append],
  );

  const run = useCallback(() => {
    const line = command.trim();
    if (!line) {
      setPhase("done");
      setVerdict("请先输入一条命令");
      setVerdictOk(false);
      return;
    }
    startRun(line);
  }, [command, startRun]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunningCommand(null);
    setPhase("stopped");
    setVerdict("已停止 —— 命令及其子进程已回收");
    setVerdictOk(false);
  }, []);

  const clear = useCallback(() => {
    setOutput("");
    setExitCode(null);
    setVerdict("");
    setPhase((prev) => (prev === "running" ? prev : "idle"));
  }, []);

  const fill = useCallback((next: string) => setCommand(next), []);

  const canRun = useMemo(
    () =>
      phase !== "running" &&
      command.trim().length > 0 &&
      command.length <= MAX_COMMAND_CHARS,
    [command, phase],
  );

  const syntaxWarning = useMemo(
    () => (command.trim() ? shellSyntaxWarning(command) : null),
    [command],
  );

  return {
    command,
    setCommand,
    phase,
    output,
    runningCommand,
    exitCode,
    verdict,
    verdictOk,
    history,
    canRun,
    maxCommandChars: MAX_COMMAND_CHARS,
    syntaxWarning,
    run,
    stop,
    clear,
    fill,
  };
}
