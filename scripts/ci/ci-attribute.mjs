/**
 * ci-attribute.mjs —— CI 红归因的**编排**（ISSUE #5182）。
 *
 * `ship --diagnose` 只取红格不归因，`base-check` 只给五态不替人决定挡不挡路；
 * 中间那段「哪条门禁 → 哪份文件 → 超时指纹才隔离复跑」全靠人临时拼命令，
 * 而错把 `load-flake` 登记成 `baseline-red`、或抬 `testTimeout` 是文档反复记账的
 * 两种高代价误判。这里只串既有执行者，不新增第六态、不改判据。
 *
 * 用法：`pnpm ci:attribute [sn] [--gate <钩子标签>] [--file <测试文件>]`
 */
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();
const TIMEOUT_RE = /timed out|timeout|超时|worker.*(?:fail|起不来)/i;

/**
 * base-check 的读数 → 是否值得隔离复跑 + 下一动作。纯函数。
 *
 * @param {{text:string, file:string|null}} input
 */
export function attributePlan({ text, file }) {
  const timedOut = TIMEOUT_RE.test(String(text ?? ""));
  return {
    timedOut,
    rerun: timedOut && Boolean(file),
    next: timedOut
      ? file
        ? "带超时指纹 ⇒ 按确定性等待后串行复跑同一份清单；不许抬 testTimeout"
        : "带超时指纹但没点名文件 ⇒ 先用 --file 点名要复跑的那份"
      : "不带超时指纹（真断言红）⇒ 一次都不复跑，按五态下一动作归因",
  };
}

/**
 * @param {{sn:string|null, gate:string|null, file:string|null}} opts
 * @param {(cmd:string,args:string[])=>{status:number|null,stdout:string,stderr:string}} run
 */
export function runAttribute({ sn, gate, file }, run) {
  const lines = [];
  const diagnoseArgs = ["scripts/ship/ship.mjs", "--diagnose", ...(sn ? [sn] : [])];
  const diag = run(process.execPath, diagnoseArgs);
  lines.push(`[ci:attribute] diagnose 退 ${String(diag.status)}（诊断只读，不归因）`);
  let baseText = "";
  if (gate) {
    const base = run(process.execPath, ["scripts/gates/base-check.mjs", gate]);
    baseText = `${base.stdout ?? ""}\n${base.stderr ?? ""}`;
    lines.push(`[ci:attribute] base-check「${gate}」退 ${String(base.status)}`);
    lines.push(baseText.trim());
  } else {
    lines.push("[ci:attribute] 没给 --gate ⇒ 只出诊断；下一动作：base-check <拦住你的那条>");
  }
  const plan = attributePlan({ text: baseText, file });
  lines.push(`[ci:attribute] ${plan.next}`);
  return { lines, plan };
}

/** @param {string[]} argv */
function main(argv) {
  const gateAt = argv.indexOf("--gate");
  const fileAt = argv.indexOf("--file");
  const gate = gateAt === -1 ? null : String(argv[gateAt + 1] ?? "");
  const file = fileAt === -1 ? null : String(argv[fileAt + 1] ?? "");
  const sn = argv.find((a) => !a.startsWith("--")) ?? null;
  const { lines, plan } = runAttribute({ sn, gate, file }, (cmd, args) =>
    runGateStep(cmd, args, { cwd: ROOT, timeoutMs: 10 * 60_000, echo: true }),
  );
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  if (plan.rerun && file) {
    const res = runGateStep(
      process.execPath,
      ["scripts/affected-tests/run-tests.mjs", file, "--", "--no-file-parallelism"],
      { cwd: ROOT, timeoutMs: 30 * 60_000, echo: true },
    );
    process.stdout.write(`[ci:attribute] 隔离复跑退 ${String(res.status)}（原值透传）\n`);
    return res.status ?? 2;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
