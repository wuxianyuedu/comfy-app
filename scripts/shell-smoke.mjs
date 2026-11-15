/**
 * `shell-smoke.mjs` —— 真实壳冒烟的**入口编排**（ISSUE #3570）。
 *
 * 它只做三件前置检查再交给观察脚本，自己一次也不判窗口行为：
 *   1. 平台：壳冒烟观察的就是 Win32 窗口行为，非 Windows 直接退 2；
 *   2. Python：观察脚本是 `win32-shell-smoke.py`（与 `win32-window-focus.py`
 *      同一族，只吃标准库），缺解释器退 2 并给安装指路；
 *   3. 被测二进制：release 版 `app.exe` 不存在退 2，并给出硬规则 5 的重编命令
 *      （feature 不能省，见 launch-and-build §5）。
 * 然后原样透传 `python scripts/win32-shell-smoke.py` 的退出码与输出 ——
 * 判决（五个场景的 PASS/FAIL 与读数）全在那一份里，这里不另立第二套。
 *
 * 用法：`pnpm shell:smoke`（等价 `python scripts/win32-shell-smoke.py`）。
 * 场景清单、读数口径与退出码见 `win32-shell-smoke.py` 的文件头。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "win32-shell-smoke.py");
const exe = path.join(root, "src-tauri", "target", "release", "app.exe");

if (process.platform !== "win32") {
  console.error(
    "[shell-smoke] 这一层观察的是 Win32 窗口行为（前台 / Z 序 / 任务栏闪烁），只在 Windows 上跑。",
  );
  process.exit(2);
}
if (!existsSync(exe)) {
  console.error(
    `[shell-smoke] 找不到 ${exe} —— 先按硬规则 5 重编壳：` +
      "cd src-tauri && cargo build --release --features custom-protocol",
  );
  process.exit(2);
}
const python = process.env.COMFYAPP_SMOKE_PYTHON || "python";
const probe = spawnSync(python, ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error(
    `[shell-smoke] 找不到可用的 Python（${python} --version 退 ${probe.status}）。` +
      "壳冒烟的观察脚本是 Python（与 win32-window-focus.py 同族）；装好 Python 后重跑，" +
      "或用 COMFYAPP_SMOKE_PYTHON 指到可用的解释器。",
  );
  process.exit(2);
}

const run = spawnSync(python, [script], { stdio: "inherit" });
process.exit(run.status ?? 2);
