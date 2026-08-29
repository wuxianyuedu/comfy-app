/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
/**
 * `executor-cli.ts` — comfy-cli 执行路径（raw UI-format 工作流）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「comfy-cli 提交路径」模块（T12 batch 4）：
 *   - {@link cliProcs}          正在运行的 comfy-cli 子进程表（供取消）
 *   - {@link executeViaComfyCli} raw UI-format 工作流提交 + stdout 事件收割
 *   - {@link applyRawOverrides}  把 canvas 的 workflowInputs 注入 raw json
 *
 * Raw UI-format workflows（liblib subgraph wrapper 的 `rawJson` 带 UUID
 * `class_type`）无法直接 POST 给 ComfyUI，交给 comfy-cli 做客户端侧
 * UI→API 转换 + 子图展开；成功/失败统一走 executor-finalize 的收口。
 *
 * @module comfyui/executor-cli
 */
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { taskRepository } from "../core/repository";
import { resolveComfyBase } from "./client";
import { extractValidationErrors } from "./validation";
import type { ValidationError } from "./validation";
import { state, log } from "./runner-state";
import type { Job, RawWorkflowOverride } from "./runner-state";
import { complete, fail } from "./executor-finalize";

export const cliProcs = new Map<string, ChildProcess>();
const CLI_TIMEOUT_MS = 25 * 60 * 1000;

/** Map an API-format node id (e.g. "76:67") or top-level id to the raw UI node. */
function resolveRawNode(raw: any, nodeId: string): any {
  const subs = raw?.definitions?.subgraphs;
  const subList: any[] = Array.isArray(subs) ? subs : Object.values(subs ?? {});
  if (nodeId.includes(":")) {
    const internalId = nodeId.split(":").pop()!;
    for (const sg of subList) {
      const n = (sg?.nodes ?? []).find((x: any) => String(x.id) === internalId);
      if (n) return n;
    }
    return null;
  }
  const top = (raw?.nodes ?? []).find((n: any) => String(n.id) === nodeId);
  if (top) return top;
  for (const sg of subList) {
    const n = (sg?.nodes ?? []).find((x: any) => String(x.id) === nodeId);
    if (n) return n;
  }
  return null;
}

/** Index of a named widget input within a UI node's `widgets_values` array. */
function widgetSlot(node: any, name: string): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (inp?.widget) {
      if (inp.name === name) return slot;
      slot++;
    }
  }
  return -1;
}

/** Best-effort injection of canvas `workflowInputs` into the raw UI json. */
export function applyRawOverrides(rawJson: any, overrides?: RawWorkflowOverride[]): any {
  if (!overrides?.length) return rawJson;
  const raw = JSON.parse(JSON.stringify(rawJson));
  for (const ov of overrides) {
    if (!ov?.nodeId || ov.value === undefined) continue;
    const node = resolveRawNode(raw, ov.nodeId);
    if (!node) continue;

    // Seed "control after generate" is NOT a named widget in raw UI format — it
    // is serialized as the widgets_values slot immediately after the seed widget.
    // Resolve the seed widget slot and target slot+1. (API-format graphs instead
    // carry a real `control_after_generate` input, handled by the name branch.)
    if (ov.name === "control_after_generate") {
      const seedSlot = seedWidgetSlot(node);
      if (seedSlot < 0) continue;
      if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
      node.widgets_values[seedSlot + 1] = ov.value;
      continue;
    }

    const slot = widgetSlot(node, ov.name);
    if (slot < 0) continue;
    if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
    node.widgets_values[slot] = ov.value;
  }
  return raw;
}

/** Index of the seed-type widget within a UI node's `widgets_values` array.
 *  Returns -1 when the node has no seed-like widget. */
function seedWidgetSlot(node: any): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const wname = typeof inp.widget === "string" ? inp.widget : inp.widget.name ?? inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) return slot;
    slot++;
  }
  return -1;
}

export async function executeViaComfyCli(job: Job) {
  const s = state();
  const { taskId, rawJson, overrides } = job;
  // R-ardot115 (2026-08-18): the entry line of the raw path so the
  // user can see in the log panel exactly which method is handling
  // their task.  Before this it was silent until the first stdout
  // JSON event arrived (often 5-30s in, the Python venv boot).
  log(taskId, "info", `→ executeViaComfyCli 入口（raw UI-format）`);
  const base = await resolveComfyBase();
  let host = "127.0.0.1";
  let port = 8188;
  try {
    const u = new URL(base);
    host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
    port = parseInt(u.port) || 8188;
  } catch { /* keep defaults */ }
  log(taskId, "info", `ComfyUI 目标：${host}:${port}（${base}）`);

  const patched = applyRawOverrides(rawJson, overrides);
  const tmpDir = path.join(process.cwd(), ".workbuddy", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `wf-${taskId}.json`);
  log(taskId, "info", `写入临时工作流文件：${tmpFile}`);
  await fs.writeFile(tmpFile, JSON.stringify(patched), "utf-8");
  // R-ardot65 (2026-08-15): 记下本次实际提交给 ComfyUI 的 workflow（liblib
  // subgraph 未展开格式），任务完成落盘为 workflow.json 供完整复现。
  s.executedWorkflow.set(taskId, patched);
  log(
    taskId,
    "info",
    `工作流文件就绪（${Object.keys((patched)?.nodes ?? {}).length || Object.keys(patched).length} 节点）`
  );

  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const pyName = process.platform === "win32" ? "python.exe" : "python";
  const py = path.join(
    process.cwd(),
    ".workbuddy",
    "python-venv",
    "comfy-cli",
    binDir,
    pyName
  );
  const args = [
    "-m", "comfy_cli", "run",
    "--workflow", tmpFile,
    "--json", "--wait",
    "--where", "local",
    "--host", host,
    "--port", String(port),
    "--no-notify",
    "--timeout", "600",
  ];

  // R-ardot115 (2026-08-18): surface the literal comfy-cli command so
  // the user (and we, on support) can reproduce the exact invocation
  // from the log panel without digging through devtools.
  log(
    taskId,
    "info",
    `comfy-cli 执行 raw 工作流（${host}:${port}）`
  );
  log(taskId, "info", `  ${pyName} ${args.join(" ")}`);
  // R-ardot111 (2026-08-17): explicit pre-spawn line so the user
  // sees a "→ 启动" marker before the (potentially slow) Python
  // boot.  Without this, the first log on a raw submission was
  // "comfy-cli 执行 raw 工作流" + a long silence, which looks
  // indistinguishable from a hang.
  log(taskId, "info", `→ 启动 comfy-cli 进程（raw UI-format → API 转换）`);
  s.emitter.emit(taskId, {
    type: "log",
    entry: { t: Date.now(), level: "info", msg: "已使用 comfy-cli 提交 raw 工作流" },
  });

  let promptId: string | null = null;
  let settled = false;

  const child = spawn(py, args, {
    cwd: process.cwd(),
    env: { ...process.env, DO_NOT_TRACK: "1", COMFY_CLI_NO_TELEMETRY: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  cliProcs.set(taskId, child);
  log(
    taskId,
    "info",
    `comfy-cli 进程已启动（pid=${child.pid ?? "?"}，等待 stdout…）`
  );

  const guard = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    cliProcs.delete(taskId);
    void fail(taskId, promptId ?? "", "comfy-cli 执行超时（看门狗）");
  }, CLI_TIMEOUT_MS);

  // R-ardot115 (2026-08-18): flatten /prompt errors returned via
  // comfy-cli's envelope into a structured `validationErrors[]` and
  // pass them to `fail()` as the 4th arg, mirroring the API-format
  // branch at line ~1226.  comfy-cli ships the upstream /prompt
  // response under `env.error`; we look for `node_errors` first, then
  // fall back to the message string.  Without this, the user only
  // ever saw "Workflow has N validation error(s) against server"
  // with no per-field breakdown, and the "↻ 重新执行" hint for
  // re-running to populate structure was a no-op (re-running the
  // SAME workflow would produce the SAME envelope with the SAME
  // unflattened payload).
  // R-ardot118 (2026-08-18): comfy-cli wraps the upstream /prompt
  // payload in an `envelope`. The structured `node_errors` lands at
  // several possible positions depending on the comfy-cli version:
  //   • error.details.node_errors  → LIST of records (this is what
  //     `_node_errors_to_list()` produces and what actually reaches us)
  //   • error.node_errors          → dict (defensive)
  //   • node_errors                → dict (defensive)
  //   • data/response/result.*     → future-proofing
  // A single `env.error.node_errors` check (the old code) only ever saw
  // {code, message, hint, details} — which has NO `node_errors` — so the
  // 6-item per-field list never rendered.  Deep-search the envelope for
  // `node_errors` (dict or list) and hand it to extractValidationErrors,
  // which now accepts both shapes.
  const findNodeErrorsCarrier = (root: any, depth = 5): any => {
    if (!root || typeof root !== "object") return undefined;
    const seen = new WeakSet<any>();
    const stack: { node: any; d: number }[] = [{ node: root, d: 0 }];
    while (stack.length) {
      const { node, d } = stack.pop()!;
      if (d > depth || seen.has(node)) continue;
      seen.add(node);
      if (node && typeof node === "object") {
        const ne = (node).node_errors;
        if (ne != null && (Array.isArray(ne) ? ne.length : Object.keys(ne).length)) {
          return ne;
        }
        for (const v of Object.values(node)) {
          if (v && typeof v === "object") stack.push({ node: v, d: d + 1 });
        }
      }
    }
    return undefined;
  };

  const extractEnvelopeValidationErrors = (env: any): ValidationError[] | undefined => {
    const carrier = findNodeErrorsCarrier(env);
    if (!carrier) return undefined;
    return extractValidationErrors(carrier, patched);
  };

  const finish = (ok: boolean, env: any) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (ok) {
      void complete(taskId, promptId ?? "");
    } else {
      const err = env?.error;
      const msg =
        (typeof err?.message === "string" ? err.message : undefined) ??
        (typeof err?.hint === "string" ? err.hint : undefined) ??
        "comfy-cli 执行失败";
      const validationErrors = extractEnvelopeValidationErrors(env);
      if (validationErrors?.length) {
        // Mirror the API-format branch's behaviour: surface the
        // structured list in a single log line for the user, then
        // pass it to fail() so the UI can render a per-field block.
        log(
          taskId,
          "error",
          `✗ comfy-cli 报 ${validationErrors.length} 条校验错误（见上方红框）`
        );
        validationErrors.slice(0, 12).forEach((ve) => {
          log(
            taskId,
            "error",
            `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
              (ve.field ? ` · 字段 ${ve.field}` : "") +
              `：${ve.message}`
          );
        });
        if (validationErrors.length > 12) {
          log(
            taskId,
            "error",
            `  …还有 ${validationErrors.length - 12} 条（请查看红框/重新执行工作流查看完整清单）`
          );
        }
      } else {
        // Comprehensive-detection safety net (R-ardot118): the message
        // says "validation error" but the deep search found no
        // structured `node_errors`.  Dump the raw envelope (truncated)
        // so a support re-run can see the real shape instead of a
        // silent "Workflow has N validation error(s)" line.
        const rawMsg = typeof msg === "string" ? msg : "";
        if (/validation error/i.test(rawMsg) || env?.error?.code === "prompt_rejected") {
          try {
            const dump = JSON.stringify(env).slice(0, 900);
            log(
              taskId,
              "warn",
              `⚠ 未从 comfy-cli envelope 解析出结构化校验错误，原始 envelope（截断）：${dump}`
            );
          } catch {
            /* stringify can throw on circular refs — ignore */
          }
        }
      }
      void fail(taskId, promptId ?? "", msg, validationErrors);
    }
  };

  let buf = "";
  let nonJsonLines = 0;
  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let ev: any = null;
      try { ev = JSON.parse(line); } catch {
        // R-ardot115 (2026-08-18): surface non-JSON lines too so the
        // user can see when comfy-cli prints a Python traceback or
        // import error.  Cap to avoid flooding the panel during
        // legitimate verbose output.
        nonJsonLines++;
        if (nonJsonLines <= 20) {
          const trimmed = line.length > 240 ? line.slice(0, 240) + "…" : line;
          log(taskId, "info", `[comfy-cli stdout] ${trimmed}`);
        } else if (nonJsonLines === 21) {
          log(taskId, "info", `[comfy-cli stdout] …后续非 JSON 行已省略（查看后端日志）`);
        }
        continue;
      }
      if (!ev || typeof ev !== "object") continue;
      if (ev.type === "queued" && ev.prompt_id) {
        promptId = ev.prompt_id;
        s.promptToTask.set(ev.prompt_id, taskId);
        void taskRepository
          .markRunning(taskId, ev.prompt_id)
          .catch(() => undefined);
        // R-ardot111 (2026-08-17): mirror the API-format branch's
        // "✓ 已接收…等待 executing" wording so the log panel shows a
        // consistent vocabulary across both submission paths.
        log(taskId, "info", `✓ comfy-cli 已提交（prompt_id: ${promptId}），等待节点执行…`);
      } else if (ev.type === "envelope") {
        finish(Boolean(ev.ok), ev);
      } else if (
        ev.type === "progress" &&
        typeof ev.completed === "number" &&
        typeof ev.total === "number" &&
        ev.total > 0
      ) {
        s.emitter.emit(taskId, {
          type: "progress",
          progress: Math.round((ev.completed / ev.total) * 100),
        });
      } else if (ev.type === "executing" || ev.type === "execution_success") {
        // R-ardot115 (2026-08-18): forward the raw CLI events for
        // per-node visibility (we can't map them back to the raw
        // graph class_type here without the original UUIDs, but the
        // node id + event type alone is enough to show "something is
        // running").
        const node = ev.node ?? ev.data?.node ?? "?";
        log(
          taskId,
          "info",
          ev.type === "execution_success"
            ? `✓ comfy-cli 节点 [${node}] 执行完成`
            : `▶ comfy-cli 节点 [${node}] 开始执行`
        );
      }
    }
  });

  // R-ardot115 (2026-08-18): stream stderr live so Python tracebacks
  // appear in the panel as they happen, instead of only at close().
  let errBuf = "";
  let errLines = 0;
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (d: string) => {
    errBuf += d;
    const lines = d.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      errLines++;
      if (errLines <= 30) {
        const t = trimmed.length > 240 ? trimmed.slice(0, 240) + "…" : trimmed;
        log(taskId, "warn", `[comfy-cli stderr] ${t}`);
      } else if (errLines === 31) {
        log(taskId, "warn", `[comfy-cli stderr] …后续错误行已省略（查看后端日志）`);
      }
    }
  });

  child.on("close", (code) => {
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (settled) return;
    settled = true;
    const tail = errBuf.trim().split("\n").slice(-12).join("\n");
    log(
      taskId,
      "error",
      `comfy-cli 进程已退出（code=${code}），未收到 envelope 事件`
    );
    void fail(taskId, promptId ?? "", `comfy-cli 异常退出（code=${code}）\n${tail || "(无 stderr)"}`);
  });

  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    log(taskId, "error", `comfy-cli 启动失败：${err.message}`);
    void fail(taskId, promptId ?? "", `comfy-cli 启动失败：${err.message}`);
  });
}
