// ── 「按平台退避着起 Python 解释器，并把它的输出按行交出去」的一份实现（服务端）──
//
// 抽出来的理由就是台账 A14：本仓早就有 `python-candidates.ts` 规定「候选名与顺序、
// `py` 必须带 `-3`」，而 `/api/custom-nodes` 那条路由在**三处**各写了一份字面量表
// `["python3","python","py"]`。字面量一抄，判据就同时存在两个答案：Windows 上真实
// 顺序是 `python → py → python3`，路由却从 `python3` 起，而且命中 `py` 那一档时起的是
// **裸 `py`**（它的语义是「列出已装版本」并退非零，不是「跑这个脚本」）。
// 表现是设置页「扫描自定义节点」显示 0 个，而界面上没有任何一句说是解释器的事。
//
// 所以这里只放**三件跨调用点同形的事**，协议本身留在调用点：
//   ① 退避链（顺序 + 每个候选的 argv）—— 转调判据，不在这里再抄一遍表；
//   ② 「这一档压根没有这个解释器」的两种形状（`ENOENT` 与退出码 127）**同因**；
//   ③ 把子进程的一条流按 `\n` 切成行（含跨 chunk 的半行、以及末尾不足一行）。
// 三条各自都曾经在一处对、一处错 —— 那正是孪生实现的标准收场（§12.12）。

import "server-only";

import { pythonCandidates, pythonProbeArgs } from "./python-candidates";

/** 退避链上的一次尝试：解释器候选名 + 该候选所需的完整参数（脚本及其参数在后）。 */
export type PythonAttempt = {
  args: Array<string>;
  command: string;
};

/**
 * 按平台给出解释器退避链。
 *
 * `platform` 形参是为了让两个平台都能被**正面**断言（真机只有一个平台，靠默认值就只剩
 * 一半判据在跑）；调用点一律不传，取的是本进程的 `process.platform`。
 *
 * 返回的数组**不为空**时才有意义：它的长度就是「全部试完」的那条边界，调用点因此
 * 不必再自写 `i < candidates.length - 1` 这种会算错的式子（A14 里 127 那一档就是这么
 * 让最后一句原因变成不可达的）。
 */
export function pythonAttempts(
  scriptArgs: ReadonlyArray<string>,
  platform: NodeJS.Platform = process.platform,
): Array<PythonAttempt> {
  return pythonCandidates(platform).map((command) => ({
    command,
    args: pythonProbeArgs(command, [...scriptArgs]),
  }));
}

/** 一次失败的可读信号：`spawn` 侧报的 `errno`，或进程收尾时的退出码。 */
export type InterpreterMissSignal = {
  errno?: string | null;
  exitCode?: number | null;
};

/**
 * 「这台机器上没有这个解释器」的两种形状 —— **必须同因**：
 * `ENOENT` 是 Node 侧报的，而 Windows 上命令不存在常常是子进程**退 127**。
 * 只认前者的那一处（本模块抽出来之前的 `streamParse`）会把「压根没装 Python」
 * 落成「解析完成，0 个节点，一句原因都没有」。
 */
export function isInterpreterMiss(signal: InterpreterMissSignal): boolean {
  return signal.errno === "ENOENT" || signal.exitCode === 127;
}

/**
 * 候选名取自判据，不在文案里抄第二份表 —— 这句是用户唯一能看到「为什么是 0 个」的出口
 * （硬规则 4），所以它必须与退避链**真的试过的那些名字**一致，而不是写死的一句旧顺序。
 */
export function missingInterpreterMessage(platform: NodeJS.Platform = process.platform): string {
  return `未找到 Python 解释器（已尝试 ${pythonCandidates(platform).join(" / ")}）`;
}

/**
 * 把子进程的一条流按行交给回调：空行跳过，跨 chunk 的半行拼回来，
 * 末尾**不足一行**在 `end` 时补发。
 *
 * 那最后一档是两条链过去分叉的地方：解析口补发，探测口不补 —— 于是解析器只在末尾
 * 打一次、且不带换行的那行结果 JSON，在探测口会被留在缓冲区里永远不解析。
 * 现在两边共用这一份，形状不再由「哪条链先写的」决定。
 */
export function forEachOutputLine(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  let buf = "";
  stream.on("data", (chunk: Buffer | string) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) {
        onLine(line);
      }
    }
  });
  stream.on("end", () => {
    const rest = buf.trim();
    if (rest) {
      onLine(rest);
    }
  });
}
