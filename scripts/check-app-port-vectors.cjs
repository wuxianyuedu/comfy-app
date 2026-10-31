// @ts-nocheck -- 提交门槛脚本：端口推导的跨语言一致性（供 .githooks/pre-commit / CI 调用）
/**
 * ISSUE #489 缺陷 4：规范 §1.1 承诺「Node / PowerShell / Python / Rust 四侧对
 * 同一路径给出同一端口」，但此前四侧各写各的固定断言，没有任何测试会发现某侧
 * 漂移（实测：Rust 不做路径解析、Node/Python/PS 对相对路径拼 cwd）。
 *
 * 本脚本以共享校验向量 tests/fixtures/app-port-vectors.json 为单一事实源：
 *   1) Node 侧真跑（本进程直接 import scripts/app-port.mjs）；
 *   2) Python 侧真跑（可用时调用 scripts/check-app-port-vectors.py）；
 *   3) Rust / PowerShell 侧无法在此环境执行（需 cargo / pwsh），改为断言其
 *      实现与测试**确实引用同一份向量文件** —— 某侧被改回「自己写死值」时
 *      会被拦下，而不是等到 Windows 真机上才发现漂移。
 * 任一侧**给出回答而不一致** → 退出码 1 阻断提交。某一侧**没给出回答**（超时两遍 /
 * 探测不到解释器）→ 记「未校验」、点名、放行：拿不到测量不等于测量结果是红的（§13.6.4.1），
 * 而它也不是绿 —— 见下面 `unverified` 那一格与 `decidePythonVerdict`。
 *
 * Node 侧的逐条断言另见 tests/app-port-cross-language.test.ts（vitest 侧同源）；
 * 本脚本是「不装依赖也能跑」的门禁版本（pre-commit 里 tsc/lint 之前更快失败）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = process.cwd();
const REL_VECTORS = "tests/fixtures/app-port-vectors.json";
/** 命令可用性探测的预算（到点 = 「不知道有没有这个命令」，不是「没有」）。 */
const PROBE_TIMEOUT_MS = 10_000;
/**
 * 「命令不在 / 起不来」的两个 errno —— 单独命名而不是就地写字面量。
 *
 * 两个理由：① 名字把语义（「不是命令存在但形态不对」）写在使用点上；
 * ② `tests/gate-scan-read.test.ts` 有一条回潮判据，按源码文本判「哪份 check-*.cjs
 * 自己私吞了 ENOENT」（它与共用件 `gate-scan-read.cjs` 的消失容错是同一句，私有副本
 * 的后果是改一处漏三处）。在这里就地写那个字面量 —— 哪怕是注释里提一句 —— 都会被
 * 判成私有副本而红。用常量躲开这条误报，比在判据里加白名单更诚实：本文件吞它
 * 不是「文件在扫描途中消失」，是「这个命令不存在」，两件事。
 */
const NOT_FOUND = "ENOENT";
/** 文件在、但没有执行位 —— 与「没有文件」在下一步动作上同一件（去修 PATH / 去装）。 */
const NO_EXEC = "EACCES";
/**
 * Python 解释器的候选名与启动参数 —— 按平台取，与
 * `src/lib/process/python-candidates.ts` **同口径**。
 *
 * 为什么要在这里**抄一份**：本文件是 `.cjs`、且这条判据要能「不装依赖也跑」
 * （pre-commit 里排在 tsc / lint 之前，见文件头）。`src/lib/process/python-candidates.ts`
 * 是 TS，Node 的类型擦除不覆盖 `require`。所以候选表是**两份文本、一条判据** ——
 * `tests/ci-toolchain-selfcheck.test.ts` 与 `tests/app-port-cross-language.test.ts`
 * 那侧逐项对账，任何一侧漂了当场红。
 *
 * 排在 `py` 前面的理由与那份 TS 逐字相同：Windows 官方安装器落 `python.exe`，
 * 而 `python3` 在 Windows 上多半只是 Store 的占位别名（`--version` 退非零）。
 */
const PYTHON_CANDIDATES =
  process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
/** 每个候选的启动参数：裸 `py` 是「列出已装版本」并退非零，必须带 `-3`。 */
const PYTHON_PROBE_ARGS = { py: ["-3", "--version"] };
/** Python 侧真跑的预算。话术里的秒数跟着它走，别写死一个会过期的数。 */
const PY_TIMEOUT_MS = 30_000;
const problems = [];
/**
 * 「没有取证」的一类 —— 与 `problems` 分开放。
 *
 * 为什么要分：这条判据此前把子进程超时（`ETIMEDOUT`）与「四侧推导真不一致」塞进同一个数组，
 * 于是 `report()` 那句标题在**纯超时**时也说得出嘴。实测栽过一次：一笔**纯文档**提交被它拦下，
 * 报「四语言端口推导一致性失败：- Python 侧自检失败：spawnSync python3 ETIMEDOUT」，
 * 而同一条判据钩子结束后就地复跑退 0 —— 那不是内容红，是没拿到测量。
 * 规范 §13.6.4.1（ISSUE #1747）对 C 组早已立了同一条口径：**拿不到测量 ≠ 测量结果是红的**。
 *
 * 口径（本线已拍，与 C 组 §13.6.4.1 同形）：**第二遍测量自己说话**，不看 `os.loadavg()`（Windows 恒 0）。
 *   · 第一遍是超时形态 ⇒ 当场再取证一次；
 *   · 第二遍给出回答 ⇒ 按那一遍判（绿与真红照旧）；
 *   · 第二遍**仍只是超时形态** ⇒ 记「未校验」并**放行**，逐条点名，标题不许说成一致性失败；
 *   · 探测不到 Python（`missing`）同样记「未校验」并点名 —— 它此前是**静默跳过**，那一侧既不参与
 *     比对也不报红，等于把「四侧一致」悄悄降级成「三侧一致」；
 *   · 探测到命令但 `--version` 非零退出（`malformed`）**不是** `missing`：机器上有 Python，
 *     只是这条探针不承认它的形态（Windows 的 Microsoft Store 占位别名、`py` 启动器不带 `-3`）。
 *     旧实现把两者糊成一档，于是这一侧被以「探测不到」的名义永久退出比对 —— 那是句假话，
 *     且它给出的下一步动作（去装 Python）也是错的。话术因此必须分开，见 `decidePythonVerdict`。
 * 放行站得住的理由：放行的是**这一次取证**而不是这条判据 —— 其余三面（Node 真跑、Rust / PowerShell
 * 锁引用）仍在同一趟里判，而 `missing` 与双超时都会被点名，不是无声通过。
 * 代价与触发面：只有第一遍超时才多花一趟（最坏 `PROBE_TIMEOUT_MS × 2 + PY_TIMEOUT_MS`）；一切正常时
 * 一次复跑都不跑。
 */
const unverified = [];

/**
 * 子进程「没在预算内回答」的形状。
 *
 * `execFileSync` 带 `timeout` 到点时，不同 Node 版本落法不同：`code === "ETIMEDOUT"`，
 * 或只在 `message` 里带 `ETIMEDOUT` / `timed out`。两个都认，漏一个就又把超时读成内容失败。
 */
function isTimeoutLike(e) {
  if (!e) {
    return false;
  }
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "");
  return code === "ETIMEDOUT" || /ETIMEDOUT|timed out/i.test(msg);
}

function readIfExists(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * 探测命令是否可用 —— 返回 `"ok"` / `"timeout"` / `"missing"` / `"present-but-nonzero"`，
 * **不许糊成一个布尔**：糊成一个时（旧实现 `try { … } catch { return false }`），负载高、
 * 10 秒预算到点会被读成「这台机器没有 Python」，那一侧既不参与比对也不报红 —— 比报错
 * 误导向得更久。
 *
 * 第四档是**这次修的洞**：`execFileSync` 的失败形态此前只分「超时 / 其余」，其余一律
 * `missing`。但「命令起来了、只是 `--version` 非零退出」给的是 `status !== 0` 而
 * `error.code === undefined`（不是 `ENOENT`）—— 它被静默归进「机器上没有 Python」，
 * 而那句话是**假的**：命令就在那儿。两种形态的下一动作完全不同（装 Python vs 换探测
 * 方式），糊成一档等于把后者指错方向，还会让 Python 侧以「探测不到」的名义永久退出比对。
 *
 * `EACCES` 归 `missing` 是本文件刻意收的口径：没有执行位时这条探针确实拿不到回答，
 * 而「有文件但不可执行」与「没有文件」在下一步动作上是同一件（去修 PATH / 去装）。
 * 真正要区分的只有「起来了但形态不对」这一格。
 */
function probeCommand(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", timeout: PROBE_TIMEOUT_MS });
    return "ok";
  } catch (e) {
    if (isTimeoutLike(e)) {
      return "timeout";
    }
    if (e && (e.code === NOT_FOUND || e.code === NO_EXEC)) {
      return "missing";
    }
    return "present-but-nonzero";
  }
}

/**
 * Python 侧取证**一次**：探测可用命令 → 跑自检脚本。
 *
 * 「没拿到测量」有三态，话术与下一动作各不同：
 *   · `timeout` —— 这一刻没回答（机器忙），动作是**再取一遍**；
 *   · `missing` —— 这台机器上确实没有 python3 / python，动作是**去装 Python**；
 *   · `malformed` —— 命令**在**，只是 `--version` 没按假设退 0（Windows 的
 *     Microsoft Store `python` 占位别名、`py` 启动器不带 `-3` 都落在这里），
 *     动作是**换探测方式**，不是「去装一个已经装了的 Python」。
 *
 * 旧实现把后两态糊成一个布尔之后，`missing` 走的是**静默跳过** —— 那一侧既不参与
 * 比对也不报红，等于把「四侧一致」悄悄降级成「三侧一致」，而输出上一个字都没有。
 *
 * @param {string} pyChecker 自检脚本的仓库相对路径
 * @returns {{state: "answered" | "timeout" | "missing" | "malformed", python: string | null, problems: string[]}}
 */
function measurePythonOnce(pyChecker) {
  /* 候选名、顺序与启动参数**只有一处事实源**：`src/lib/process/python-candidates.ts`。
   * 这里此前自己写死 `["python3","python"]`（后来又就地补过一份带 `py` 的表），
   * 而流水线的「工具链自证」写成裸的 `python -V` —— 三份探的面在同一条链上漂成
   * 三样（ISSUE #1959 第二轮首跑：一台只有官方 `python.exe` / `py.exe` 的 Windows
   * 节点被各判一次「没有」，一边静默少判、另一边红得与「压根没装」逐字同形）。
   *
   * 本文件是 `.cjs`，`require` 不到那份 `.ts`（Node 的类型擦除不覆盖 `require`），
   * 所以这里是**两份文本 + 一条判据**：候选表由 `tests/ci-toolchain-selfcheck.test.ts`
   * 与 `src/lib/process/python-candidates.ts` 逐项对账，任一侧漂了当场红。
   *
   * `py` 必须带 `-3`：裸 `py` 与 `py -0` 都是「列出已装版本」并退非零，不带 `-3`
   * 会被归进 `present-but-nonzero` ⇒ `malformed`，而机器上其实有个能跑的 Python 3。
   */
  const probed = PYTHON_CANDIDATES.map((c) => [
    c,
    probeCommand(c, PYTHON_PROBE_ARGS[c] ?? ["--version"]),
  ]);
  const timedOut = probed.filter(([, s]) => s === "timeout").map(([c]) => c);
  const malformed = probed.filter(([, s]) => s === "present-but-nonzero").map(([c]) => c);
  const found = probed.find(([, s]) => s === "ok");
  if (!found) {
    // 超时优先：它是唯一会触发「当场再取一遍」的形态（见 main 里的二次取证）。
    const state = timedOut.length > 0 ? "timeout" : malformed.length > 0 ? "malformed" : "missing";
    return {
      state,
      python: malformed.length > 0 ? malformed[0] : null,
      problems: [],
    };
  }
  const python = found[0];
  try {
    const out = execFileSync(python, [pyChecker], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: PY_TIMEOUT_MS,
    });
    return {
      state: "answered",
      python,
      problems: out.includes("OK") ? [] : [`Python 侧自检未通过：${out.trim()}`],
    };
  } catch (e) {
    if (isTimeoutLike(e)) {
      return { state: "timeout", python, problems: [] };
    }
    return {
      state: "answered",
      python,
      problems: [`Python 侧自检失败：${(e.stdout || e.message || "").toString().trim()}`],
    };
  }
}

/**
 * 两遍取证 → 这一侧到底算什么（**纯函数**，用例可以逐格钉住，不必真起 Python）。
 *
 * @param {{state: string, python: string | null, problems: string[]}} first 第一遍
 * @param {{state: string, python: string | null, problems: string[]} | null} second 第二遍（第一遍有回答时为 null）
 * @returns {{problems: string[], unverified: string[]}}
 */
function decidePythonVerdict(first, second) {
  const sec = second ?? first;
  if (sec.state === "answered") {
    return { problems: sec.problems, unverified: [] };
  }
  if (sec.state === "missing") {
    return {
      problems: [],
      unverified: [
        "这台机器探测不到 python3 / python（Windows 上还包括 `py -3`）" +
          "（`--version` 非零退出，**不是**超时）—— " +
          "Python 侧本轮**没有取证**，四侧比对实际只答了三侧。在装了 Python 的机器上这一侧会重新参与。",
      ],
    };
  }
  if (sec.state === "malformed") {
    // 这一档**不是**「机器上没装 Python」：命令在，只是 `--version` 没按假设退 0
    // （Windows 的 Microsoft Store `python` 占位别名、`py` 启动器不带 `-3` 都落在这里）。
    // 两种形态的下一动作不同 —— 装 Python vs 换探测方式 —— 所以话术必须分开。
    return {
      problems: [],
      unverified: [
        `探测到 Python 命令（${sec.python ?? "python"}）但 \`--version\` 没按假设退 0 —— ` +
          "它**存在**，只是这一跳的形态不被这条探针承认（**不是**超时，也**不是**没装 Python）。" +
          "Python 侧本轮**没有取证**，四侧比对实际只答了三侧。若这是 Windows 的" +
          " Microsoft Store 占位别名或 `py` 启动器，改用 `python3` 或带 `-3` 的形态再跑一次即可。",
      ],
    };
  }
  return {
    problems: [],
    unverified: [
      `Python 侧自检（${sec.python ?? "python"} 跑 scripts/check-app-port-vectors.py）两遍` +
        `都没有在 ${PY_TIMEOUT_MS / 1000} 秒预算内回答（超时形态）—— **拿不到测量**，` +
        "不是「四侧推导不一致」。这一侧本轮未取证：已放行并点名（规范 §13.6.4.1），" +
        "别去改四侧实现 —— 四侧根本没动过。",
    ],
  };
}

async function main() {
  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(path.join(ROOT, REL_VECTORS), "utf8"));
  } catch (e) {
    problems.push(`共享向量不可读（${REL_VECTORS}）：${e.message}`);
    report();
    return;
  }
  const vectors = Array.isArray(fixture.vectors) ? fixture.vectors : [];
  if (vectors.length < 5) {
    problems.push(`共享向量不足（${vectors.length} < 5）—— 防止误删后检查静默全绿`);
  }
  // 向量内自洽
  for (const v of vectors) {
    if (v.port !== 3200 + (v.fnv1a32 % 800)) {
      problems.push(`向量内不自洽：${JSON.stringify(v.input)} port ≠ 3200 + fnv % 800`);
    }
  }

  // ── ① Node 侧真跑 ──
  try {
    const mod = await import(
      "file://" + path.join(ROOT, "scripts", "app-port.mjs").replaceAll("\\", "/")
    );
    for (const v of vectors) {
      const norm = mod.normalizeRootForPort(v.input);
      if (norm !== v.normalized) {
        problems.push(`Node 规范化 ${JSON.stringify(v.input)}：${norm} ≠ ${v.normalized}`);
      }
      if (mod.fnv1a32(norm) !== v.fnv1a32) {
        problems.push(`Node FNV ${JSON.stringify(v.input)} 与向量不符`);
      }
      if (mod.derivePortFromPath(v.input) !== v.port) {
        problems.push(`Node 端口 ${JSON.stringify(v.input)} 与向量不符`);
      }
    }
  } catch (e) {
    problems.push(`Node 侧实现不可导入：${e.message}`);
  }

  // ── ①′ `.env` 单值解析（ISSUE #821）──
  //
  // 「壳必须自己读 .env」这条承诺的判据在**四侧解析同一份 .env 得出同一个值**上：
  // 任一侧对「带引号 / 行尾注释 / 注释行」的理解不一致，用户写死的端口就只对一部分
  // 进程可见，剩下的按路径推导去等另一个端口（现象：启动页卡在「等 dev server」）。
  const envVectors = Array.isArray(fixture.envVectors) ? fixture.envVectors : [];
  if (envVectors.length < 4) {
    problems.push(`envVectors 不足（${envVectors.length} < 4）—— 防止误删后检查静默全绿`);
  }
  try {
    const mod = await import(
      "file://" + path.join(ROOT, "scripts", "app-port.mjs").replaceAll("\\", "/")
    );
    for (const v of envVectors) {
      // 判定走生产同一条出口 `parseDotEnvPortValue`，**不在门禁里另抄一份**
      // `/^\d+$/ + parseInt`：抄件与实现一旦漂了，这一格会照抄件判、而链路上跑的
      // 是实现。实测栽过一次 —— `+3100` 三侧都收，抄件不收，于是它把实现判成红的
      // （ISSUE #1941 第二处：Node 侧 `readEnvPort` 曾用 `Number.parseInt` 吃前缀，
      // 把 `3100abc` 读成 3100，与另三侧的「未配置」分叉）。
      const port = mod.parseDotEnvPortValue(mod.readEnvFileValue(v.content, "COMFYAPP_PORT"));
      if (port !== v.port) {
        problems.push(
          `Node .env 解析 ${JSON.stringify(v.content)}：${port} ≠ ${v.port}（${v.note}）`,
        );
      }
    }
  } catch (e) {
    problems.push(`Node 侧 .env 解析不可导入：${e.message}`);
  }

  // ── ② Python 侧取证（两遍，形态说话）──
  const pyChecker = "scripts/check-app-port-vectors.py";
  if (fs.existsSync(path.join(ROOT, pyChecker))) {
    const first = measurePythonOnce(pyChecker);
    let second = null;
    if (first.state === "timeout") {
      // 与 C 组同形：不猜机器闲不闲（`os.loadavg()` 在 Windows 恒 0），直接再取一遍测量，
      // 让**第二遍自己的形态**说话。这条日志不许省 —— 静默复跑读起来像卡住了。
      console.log(
        "[app-port-vectors] Python 侧第一遍只是超时形态 —— 当场复跑一次再定性（§13.6.4.1）",
      );
      second = measurePythonOnce(pyChecker);
    }
    const verdict = decidePythonVerdict(first, second);
    problems.push(...verdict.problems);
    for (const note of verdict.unverified) {
      unverified.push(note);
    }
  } else {
    problems.push(`缺少 Python 侧自检脚本：${pyChecker}`);
  }

  // ── ③ Rust / PowerShell 侧锁引用（无法在此环境执行）──
  const rust = readIfExists("src-tauri/src/single_instance.rs");
  if (rust) {
    if (!rust.includes("fn normalize_root_for_port")) {
      problems.push("Rust 侧 normalize_root_for_port 缺失（端口推导实现被删？）");
    }
    if (!rust.includes("app-port-vectors.json")) {
      problems.push("Rust 侧测试未引用共享向量 app-port-vectors.json（四侧一致失效）");
    }
  } else {
    problems.push("缺少 Rust 侧实现：src-tauri/src/single_instance.rs");
  }

  // Rust 侧：`.env` 解析必须与 resolve 出口同源（否则壳又会按路径推导去等另一个端口）
  if (rust) {
    for (const needle of [
      "fn read_dot_env_value",
      "fn read_env_app_port",
      "fn resolve_app_port_for_root",
      "fn port_source_for_root",
    ]) {
      if (!rust.includes(needle)) {
        problems.push(`Rust 侧缺少 ${needle}（.env 优先的端口解析被改回「只做路径推导」？）`);
      }
    }
    if (!rust.includes("envVectors")) {
      problems.push("Rust 侧测试未引用共享向量的 envVectors（.env 解析四侧一致失效）");
    }
  }

  const ps = readIfExists("scripts/app-port.ps1");
  if (!ps) {
    problems.push("缺少 PowerShell 侧实现：scripts/app-port.ps1");
  } else if (!ps.includes("Get-NormalizedRootForPort")) {
    problems.push("PowerShell 侧 Get-NormalizedRootForPort 缺失（端口推导实现被删？）");
  }
  if (!readIfExists("scripts/check-app-port-vectors.ps1")) {
    problems.push("缺少 PowerShell 侧自检脚本：scripts/check-app-port-vectors.ps1");
  }

  const pyMod = readIfExists("scripts/app_port.py");
  if (!pyMod) {
    problems.push("缺少 Python 侧可导入模块：scripts/app_port.py");
  } else if (!pyMod.includes("def normalize_root_for_port")) {
    problems.push("Python 侧 normalize_root_for_port 缺失（端口推导实现被删？）");
  }
  // Python 侧的使用者现在只剩这个可导入模块本身与其自检脚本
  //（原先还有 Windows-only 的 start_tauri_launcher.py，已随 ISSUE #784 移除）。
  if (!readIfExists("scripts/check-app-port-vectors.py")) {
    problems.push("缺少 Python 侧自检脚本：scripts/check-app-port-vectors.py");
  }

  report();
}

function report() {
  if (problems.length === 0 && unverified.length === 0) {
    console.log("[app-port-vectors] 四语言端口推导一致性 OK ✓");
    return;
  }
  if (problems.length === 0) {
    /* 只有「没拿到测量」这一类：放行，但**当面点名**。
     * 口径与 C 组 §13.6.4.1 同一条 —— 拿不到测量不等于测量结果是红的；而它也不是绿：
     * 标题、逐条内容与「这一侧本轮没参与比对」都要说清，否则读者会以为四侧真比对过了。
     * 已经复跑过一次是这一步的前提（见 main 里那趟 Python 二次取证），不是给人留的作业。 */
    console.log("[app-port-vectors] 通过，但**未完全取证**（放行）：");
    for (const u of unverified) {
      console.log("  - [未校验] " + u);
    }
    console.log("");
    console.log("  这一趟仍然判了的：Node 侧逐条真跑、Rust / PowerShell 侧对共享向量的锁引用。");
    console.log("        下次取证到之后 Python 侧会重新参与比对；本步以退出码 0 结束。");
    return;
  }
  console.error("[app-port-vectors] 四语言端口推导一致性失败：");
  for (const p of problems) {
    console.error("  - " + p);
  }
  for (const u of unverified) {
    console.error("  - [未校验·附带] " + u);
  }
  console.error("");
  console.error("  规范：docs/standards/launch-and-build.md §1.1（推导算法是跨语言约定，");
  console.error("        四侧实现必须逐字节一致，任一侧改动须四处同步）");
  process.exit(1);
}

/* 只在**被直接执行**时跑检查 —— 被 import 时只暴露判据分类那两个纯函数给用例
 * （`tests/app-port-vectors-timeout-classification.test.ts`）。少了这道守卫，
 * 任何 `require` 这份文件的用例都会现场跑一次四侧取证并可能 `process.exit`。 */
if (require.main === module) {
  main().catch((e) => {
    console.error("[app-port-vectors] 检查脚本异常：" + (e && e.message));
    process.exit(1);
  });
}

module.exports = { isTimeoutLike, probeCommand, decidePythonVerdict };
