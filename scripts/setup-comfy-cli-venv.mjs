#!/usr/bin/env node
/**
 * setup-comfy-cli-venv.mjs — 准备 comfy-cli 的 Python 虚拟环境（跨平台唯一实现）。
 *
 * 背景：raw UI-format（liblib 子图）工作流需要交给 comfy-cli 做 UI→API 转换，
 * `src/lib/comfyui/executor-cli.ts` 固定使用 `<项目根>/python-venv/comfy-cli` 下的
 * Python 解释器（读侧按平台认 `Scripts/python.exe` 与 `bin/python`，
 * 见 `src/lib/comfyui/comfy-cli-python.ts`）。该 venv 不存在时 spawn 直接 ENOENT，
 * 用户只看到一串 spawn 报错，无从下手。本脚本把「建 venv → 升 pip → 装 comfy-cli」
 * 固化下来。ISSUE #2197：此前这套逻辑只住在 `setup-comfy-cli-venv.ps1`
 * （Windows 单侧，读侧却早已支持 POSIX 布局）——现在逻辑全部在本文件，
 * `.ps1` 是薄壳入口（定位项目根 → 调用本文件，硬规则 12 的既定形状）。
 *
 * 幂等：venv 已存在且 comfy_cli 可导入时不重装；已就绪的 venv 走「版本检查 →
 * 需要则升级」，默认每 24h 才联网查一次最新版（避免每次启动都打扰 PyPI），
 * `--force` 可跳过节流立即检查。拿不到最新版本信息（离线 / PyPI 不可达）或升级
 * 失败都只记日志并保持已安装版本——venv 仍可用，不阻断启动。
 *
 * POSIX 前置（与 Windows 侧的不对称，#2197 定的口径）：`python3 -m venv` 依赖
 * 系统的 `ensurepip`（Debian/Ubuntu 系要单独的 `python3-venv` 包）。缺件时本脚本
 * **不静默安装**（装系统包要 sudo，不是脚本该做的事），而是打印一条可复制的
 * 安装指引后非零退出 —— Windows 侧的 winget/官网安装同样是人做，两侧对称。
 *
 * 产物：
 *   日志   log/tools/comfy-cli-setup.log
 *   状态   run/comfy-cli-setup.json   （{ phase, message, done, error, updated_at }）
 *   节流   run/comfy-cli-upgrade-check.json （{ last_check_at, installed, latest }）
 *
 * 解释器版本下限**只有一处定义**：`scripts/ci-env-probe.mjs` 的
 * `PYTHON_MIN_VERSION`（环境前提探针与升级指引都引用它，别另抄数字）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PYTHON_MIN_VERSION } from "./ci-env-probe.mjs";
import { whichCommand } from "./launcher-core/shell.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");
const PYTHON_MIN_TEXT = `${PYTHON_MIN_VERSION[0]}.${PYTHON_MIN_VERSION[1]}`;

const LogDir = path.join(ROOT, "log", "tools");
const RunDir = path.join(ROOT, "run");
const LogFile = path.join(LogDir, "comfy-cli-setup.log");
const StatusFile = path.join(RunDir, "comfy-cli-setup.json");
const VenvDir = path.join(ROOT, "python-venv", "comfy-cli");
const UpgradeStateFile = path.join(RunDir, "comfy-cli-upgrade-check.json");

const isWin = process.platform === "win32";
const VenvPy = isWin
  ? path.join(VenvDir, "Scripts", "python.exe")
  : path.join(VenvDir, "bin", "python");

/** 最新版检查的最小间隔（小时）：启动是高频动作，没必要每次都联网问 PyPI。 */
const UpgradeCheckIntervalHours = 24;
const STEP_TIMEOUT_DEFAULT_MS = 900_000;

/** 按行追加到本次运行的日志（写失败不改主流程结论）。
 *
 * @param {string} level
 * @param {string} message
 */
function writeLog(level, message) {
  const ts = new Date().toTimeString().slice(0, 8);
  try {
    mkdirSync(LogDir, { recursive: true });
    appendFileSync(LogFile, `[${ts}] [${level}] ${message}\n`, "utf8");
  } catch {
    /* 日志写入失败不影响主流程 */
  }
}

/** 进度快照（启动器读的是一份 JSON，不是日志）。
 *
 * @param {string} phase
 * @param {string} message
 * @param {{done?: boolean, failed?: boolean}} [flags]
 */
function writeStatus(phase, message, { done = false, failed = false } = {}) {
  try {
    mkdirSync(RunDir, { recursive: true });
    writeFileSync(
      StatusFile,
      JSON.stringify({
        phase,
        message,
        done,
        error: failed,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
  } catch {
    /* 状态写入失败不影响主流程 */
  }
}

/** 跑一步子进程并收 stdout/stderr（maxBuffer 给足 —— pip 的输出很容易超 1MB）。
 *
 * @param {string} label
 * @param {string} file
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {{ ok: boolean, stdout: string, stderr: string }}
 */
function runStep(label, file, args, timeoutMs = STEP_TIMEOUT_DEFAULT_MS) {
  writeLog("STEP", label);
  writeLog("INFO", `> ${file} ${args.join(" ")}`);
  const r = spawnSync(file, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  /* `spawnSync` 把 `error` 声明成 `Error`，而「超时 / 起不来」带的是 ErrnoException
   * —— 那一句 `ETIMEDOUT` 只能从 `.code` 上读到（cast 形状同 ci-cp936-exit.mjs）。 */
  const spawnError = /** @type {NodeJS.ErrnoException | undefined} */ (r.error);
  if (spawnError?.code === "ETIMEDOUT") {
    writeLog("ERROR", `${label} 超时（${Math.round(timeoutMs / 1000)}s）`);
    return { ok: false, stdout: "", stderr: "" };
  }
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 子进程起不来时 stdout 实测为 undefined（@types/node 声明偏窄）
  const stdout = String(r.stdout ?? "");
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上：stderr
  const stderr = String(r.stderr ?? "");
  if (stdout.trim()) {
    writeLog("INFO", stdout.trim());
  }
  if (stderr.trim()) {
    writeLog("WARN", stderr.trim());
  }
  if (r.status !== 0) {
    writeLog("ERROR", `${label} 失败（exit=${r.status ?? "?"}）`);
    return { ok: false, stdout, stderr };
  }
  writeLog("OK", `${label} 完成`);
  return { ok: true, stdout, stderr };
}

function isComfyCliInstalled() {
  if (!existsSync(VenvPy)) {
    return false;
  }
  const r = spawnSync(VenvPy, ["-c", "import comfy_cli"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  return r.status === 0;
}

function getInstalledComfyCliVersion() {
  const r = runStep(
    "读取已安装的 comfy-cli 版本",
    VenvPy,
    ["-m", "pip", "show", "comfy-cli"],
    120_000,
  );
  if (!r.ok) {
    return null;
  }
  return /^Version:\s*(\S+)/m.exec(r.stdout)?.[1] ?? null;
}

function getLatestComfyCliVersion() {
  const r = runStep(
    "查询 comfy-cli 最新版本",
    VenvPy,
    ["-m", "pip", "index", "versions", "comfy-cli"],
    180_000,
  );
  if (!r.ok) {
    // 离线 / PyPI 不可达是常态而非故障：保持已安装版本，不阻断启动
    writeLog("WARN", "查询 comfy-cli 最新版本失败，跳过升级检查（离线或 PyPI 不可达）");
    return null;
  }
  return /^comfy-cli\s*\(([^)]+)\)/m.exec(r.stdout)?.[1] ?? null;
}

/** 版本号逐段比（非数字段退回字符串序 —— PyPI 上带后缀的版号走的就是那一支）。
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareVersions(left, right) {
  const pa = String(left).split(/[.+-]/);
  const pb = String(right).split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      return String(pa[i] ?? "").localeCompare(String(pb[i] ?? ""));
    }
    if (na !== nb) {
      return na - nb;
    }
  }
  return 0;
}

function readUpgradeState() {
  try {
    return JSON.parse(readFileSync(UpgradeStateFile, "utf8"));
  } catch {
    return null;
  }
}

/** 记下这次检查的时刻与两端版号（节流读的就是这一份）。
 *
 * @param {string} installed
 * @param {string} latest
 */
function saveUpgradeState(installed, latest) {
  try {
    mkdirSync(RunDir, { recursive: true });
    writeFileSync(
      UpgradeStateFile,
      JSON.stringify({
        last_check_at: new Date().toISOString(),
        installed,
        latest,
      }),
      "utf8",
    );
  } catch {
    /* 节流状态写失败不影响主流程 */
  }
}

/** 距上次检查是否已到最小间隔（`--force` 直接放行）。
 *
 * @param {boolean} force
 * @returns {boolean}
 */
function upgradeCheckDue(force) {
  if (force) {
    return true;
  }
  const state = readUpgradeState();
  if (!state?.last_check_at) {
    return true;
  }
  const last = Date.parse(state.last_check_at);
  if (Number.isNaN(last)) {
    return true;
  }
  return Date.now() - last >= UpgradeCheckIntervalHours * 3_600_000;
}

/** 在 PATH 上找可用的基础 Python（python / python3 / py 启动器）。 */
function findBasePython() {
  for (const name of ["python", "python3", "py"]) {
    const candidate = whichCommand(name);
    if (candidate) {
      return { name, path: candidate };
    }
  }
  return null;
}

/** POSIX 上 `python3 -m venv` 缺 ensurepip 时的可复制指引（#2197 定的口径：
 * 不静默安装 —— 装系统包要 sudo，不是脚本该做的事；与 Windows 侧「人装
 * Python」对称）。 */
function printPosixVenvGuide() {
  const lines = [
    "[setup-comfy-cli-venv] 创建虚拟环境失败 —— POSIX 上 `python3 -m venv` 依赖",
    "[setup-comfy-cli-venv] 系统 的 ensurepip（Debian/Ubuntu 系在单独的 python3-venv 包里）。",
    "[setup-comfy-cli-venv] 可复制的安装指引（选你的发行版 / 包管理器）：",
    "[setup-comfy-cli-venv]   Debian/Ubuntu: sudo apt install python3-venv python3-pip",
    "[setup-comfy-cli-venv]   Fedora:        sudo dnf install python3-pip",
    "[setup-comfy-cli-venv]   Arch:          sudo pacman -S python-pip",
    "[setup-comfy-cli-venv]   macOS(brew):   brew install python",
    "[setup-comfy-cli-venv] 装好后重跑本脚本：node scripts/setup-comfy-cli-venv.mjs",
  ];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

/** 主流程。返回退出码。 */
function main() {
  const force = process.argv.includes("--force") || process.argv.includes("-f");
  writeLog("INFO", "=== comfy-cli 环境检查开始 ===");

  if (existsSync(VenvPy) && isComfyCliInstalled()) {
    const installed = getInstalledComfyCliVersion();
    writeLog("INFO", `comfy-cli 环境已就绪：${VenvPy}（v${installed ?? "?"}）`);

    if (!upgradeCheckDue(force)) {
      writeLog(
        "OK",
        `距上次升级检查不足 ${UpgradeCheckIntervalHours}h，跳过（立即检查：加 --force）`,
      );
      writeStatus("done", `comfy-cli 环境已就绪（v${installed ?? "?"}）`, {
        done: true,
      });
      return 0;
    }

    const latest = getLatestComfyCliVersion();
    if (!latest) {
      writeLog("WARN", `未取到最新版本，保持已安装版本 ${installed ?? "?"}`);
      writeStatus("done", `comfy-cli 环境已就绪（v${installed ?? "?"}）`, {
        done: true,
      });
      return 0;
    }

    if (compareVersions(installed ?? "0", latest) >= 0) {
      writeLog("OK", `comfy-cli 已是最新版（${installed}）`);
      saveUpgradeState(installed ?? "", latest);
      writeStatus("done", `comfy-cli 环境已就绪（v${installed}）`, {
        done: true,
      });
      return 0;
    }

    writeLog("WARN", `comfy-cli 有新版本：${installed} → ${latest}，开始升级`);
    writeStatus("upgrade", `正在升级 comfy-cli（${installed} → ${latest}）…`);
    const up = runStep(
      "升级 comfy-cli",
      VenvPy,
      ["-m", "pip", "install", "--upgrade", "comfy-cli"],
      1_800_000,
    );
    if (up.ok) {
      const after = getInstalledComfyCliVersion();
      writeLog("OK", `comfy-cli 升级完成：${installed} → ${after}`);
      saveUpgradeState(after ?? "", latest);
      writeStatus("done", `comfy-cli 已升级至 v${after ?? "?"}`, {
        done: true,
      });
      return 0;
    }
    // 升级失败不阻断：venv 仍在，旧版本可继续工作，下次启动再试
    writeLog("ERROR", `comfy-cli 升级失败，继续使用已安装版本 ${installed}`);
    saveUpgradeState(installed ?? "", latest);
    writeStatus("done", `comfy-cli 升级失败，继续使用 v${installed ?? "?"}（详见日志）`, {
      done: true,
    });
    return 0;
  }

  if (!existsSync(VenvPy)) {
    writeLog("WARN", `未找到虚拟环境，准备创建：${VenvPy}`);
    writeStatus("venv", "正在创建 comfy-cli 虚拟环境…");

    const basePy = findBasePython();
    if (!basePy) {
      writeLog("ERROR", "未找到 Python，无法创建虚拟环境");
      writeStatus("error", `未找到 Python，请先安装 Python ${PYTHON_MIN_TEXT}+`, { failed: true });
      process.stderr.write(
        `[setup-comfy-cli-venv] 未找到 Python —— 本仓下限 Python ${PYTHON_MIN_TEXT}` +
          `（唯一定义：scripts/ci-env-probe.mjs 的 PYTHON_MIN_VERSION）。\n`,
      );
      return 1;
    }
    if (!pythonMeetsFloor(basePy.path)) {
      writeStatus("error", `基础 Python 低于本仓下限 Python ${PYTHON_MIN_TEXT}+`, { failed: true });
      return 1;
    }
    writeLog("INFO", `使用基础 Python：${basePy.path}`);

    // py.exe 启动器需要显式 -3 才会选 Python 3
    const venvArgs =
      isWin && path.basename(basePy.path).toLowerCase() === "py.exe"
        ? ["-3", "-m", "venv", VenvDir]
        : ["-m", "venv", VenvDir];

    const created = runStep("创建虚拟环境", basePy.path, venvArgs, 300_000);
    if (!created.ok) {
      if (!isWin) {
        printPosixVenvGuide();
      }
      writeStatus("error", "创建虚拟环境失败，详见 log/tools/comfy-cli-setup.log", {
        failed: true,
      });
      return 1;
    }
  }

  writeStatus("pip", "正在安装 comfy-cli（首次较慢）…");

  if (!runStep("升级 pip", VenvPy, ["-m", "pip", "install", "--upgrade", "pip"], 600_000).ok) {
    writeStatus("error", "升级 pip 失败，详见 log/tools/comfy-cli-setup.log", {
      failed: true,
    });
    return 1;
  }

  if (!runStep("安装 comfy-cli", VenvPy, ["-m", "pip", "install", "comfy-cli"], 1_800_000).ok) {
    writeStatus("error", "安装 comfy-cli 失败，详见 log/tools/comfy-cli-setup.log", {
      failed: true,
    });
    return 1;
  }

  // 刚装上的就是最新版，记录一次检查时间，避免下次启动立刻再查一遍
  saveUpgradeState(getInstalledComfyCliVersion() ?? "", "");

  writeLog("OK", `comfy-cli 环境已就绪：${VenvPy}`);
  writeStatus("done", "comfy-cli 环境已就绪", { done: true });
  return 0;
}

/** 基础 Python 是否达到本仓下限（判据与话术同源：ci-env-probe.mjs 的唯一实现）。
 *
 * @param {string} pythonPath
 * @returns {boolean}
 */
function pythonMeetsFloor(pythonPath) {
  const r = spawnSync(pythonPath, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 子进程起不来时 stdout/stderr 实测为 undefined（@types/node 声明偏窄）
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  if (!m) {
    writeLog(
      "WARN",
      `基础 Python 版本读不出来（${out.trim().slice(0, 80)}）—— 按「不知道」放行，交给环境前提探针裁决`,
    );
    return true;
  }
  const [maj, min] = PYTHON_MIN_VERSION;
  const ok = Number(m[1]) > maj || (Number(m[1]) === maj && Number(m[2]) >= min);
  if (!ok) {
    writeLog(
      "ERROR",
      `基础 Python ${m[1]}.${m[2]} 低于本仓下限 ${PYTHON_MIN_TEXT}（唯一定义：scripts/ci-env-probe.mjs）`,
    );
  }
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
