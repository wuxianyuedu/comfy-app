#!/usr/bin/env node
/**
 * shell-gate-cargo.mjs — 壳门禁的**寻址判据**：cargo 在哪、探了哪几处、为什么没命中。
 *
 * 为什么单独一个文件（ISSUE #2374）：这一段是「找不到 cargo」唯一的取证面，它的变化方向
 * 与「找到 cargo 之后判什么」（`shell-gate.mjs` 的 `runCargoTest` / `materializeCargoTestInputs` /
 * `freshnessProblem` / `runGate`）不同 —— 前者跟着**安装形态**动（subst 盘符、用户级
 * `CARGO_HOME`、rustup 的 `settings.toml`、多工具链），后者跟着**判决链**动。
 * 叠在一个文件里落 #2374 时到了 925 行，撞上 R5 的 900 行硬闸（那一闸的出口只有一个：拆）。
 *
 * 判据本身一字未改地搬过来，`shell-gate.mjs` 把它们原样 re-export —— 既有调用方与
 * 用例的导入路径不变。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { whichCommand } from "./launcher-core/shell.mjs";

/**
 * `findCargo()` 走过的那几步（顺序即判据）。`probed` 是留给「找不到」时那句话的
 * 取证：**探了哪几处、为什么每一处都没命中** —— 只说「找不到 cargo」的话，
 * 拿 `CARGO_HOME` 配着工具链的人除了猜没有别的路（ISSUE #2293 的现场）。
 *
 * @typedef {{ where: string, result: "hit" | "absent" | "unreadable" | "empty", detail?: string }} CargoProbe
 *   `where` 是给人看的落点（`PATH` / 绝对路径），`result` 三态与 `absent`（不存在）
 *   分开：**目录在但读不了**（服务账号没权限）与**目录不在**是两件事，混成一句会把人
 *   引到「去装 rustup」那条错路上。
 * @typedef {{ path: string | null, probes: CargoProbe[] }} CargoLookup
 */

/**
 * cargo 的寻址判据：**PATH 优先，回退到工具链的默认安装位**。返回落点与走过的每一步。
 *
 * 为什么不能只认 PATH（ISSUE #1555）：CI / 容器镜像是**精修过 PATH** 的 ——
 * `~/.cargo/bin` 常常不在（实测本仓开发容器里 `which cargo` 为空，而同一台机器上
 * `~/.cargo/bin/cargo` 与 `~/.rustup/toolchains/<版本>/bin/cargo` 都在）。那种机器上
 * 改一行 Rust 就被判成「编不了」，而真因只是「探针比 cargo 装得更苛刻」。
 * 单独认安装位也不行：PATH 上那份**才是**要跑的那份（用户可能自选工具链、
 * 或用 distro 包管理器装的那份），越过 PATH 去猜 rustup 的目录 = 拿另一个
 * 版本编壳。两条并成一条判据：先问 PATH，问不到才回退。
 *
 * 回退面刻意**只收 rustup 自己说得出的那几处**（CARGO_HOME/bin、~/.cargo/bin、
 * ~/.rustup/toolchains/），不做 PATH 式的目录递归 —— 判据越宽，越可能选中一个不该用的 cargo。
 *
 * ⚠️ **「哪几处」不许只从环境变量推**（ISSUE #2374）：`CARGO_HOME` 是**用户级**变量，
 * 服务账号会话里通常是空的，而 cargo 就装在那个用户的 `~/.cargo/bin` 下。旧判据里
 * `$CARGO_HOME/bin` 那一处随变量一起消失、`~/.cargo/bin` 又只按 `os.homedir()` 求，
 * 于是「装在 `G:\.cargo\bin\cargo.exe`、而 CARGO_HOME 没传进来」这一形态三处全空 ——
 * 结论是「找不到 cargo」，而盘上那份一直在。所以候选**有两条来源**：
 *   · 环境变量（`CARGO_HOME`）；
 *   · rustup 自己记着的事实（`$RUSTUP_HOME\settings.toml` 的 `cargo_home`，
 *     `RUSTUP_HOME` 未设时读 `~/.rustup/settings.toml`），以及 `USERPROFILE` / `HOME`
 *     与 `os.homedir()` 不一致时的另一种 `~/.cargo/bin` 写法。
 * 两路都只产出**有限几个候选目录**，一个字节也不递归。
 *
 * ⚠️ **`$CARGO_HOME/bin` 要真的进 PATH**（ISSUE #2293 的平台现场）：`.cnb.yml` 给
 * `重档静态判据` 那一格配了 `CARGO_HOME` / `RUSTUP_HOME`，而**平台 runner 的 PATH 是
 * 固定的**、不会跟着这两个变量长出来 ⇒ 下面那条 `PATH` 探针必然落空，一整格按
 * 「没跑起来」收（退 2）。这时唯一的出路就是这条回退 —— 它本来就该命中
 * `$CARGO_HOME/bin/cargo`，值的形状（`G:\.cargo`、`C:/Users/x/.cargo`、带尾部分隔符）
 * 不许成为「命不命中」的变量。
 *
 * ⚠️ **回退面的每一处都走 `probeCargoIn()`**（ISSUE #2368）：`$CARGO_HOME` 常常落在
 * **subst 出来的盘符**上（平台节点就是 `G:`），而那条路径对 Node 的 `fs` 是假阴性。
 * 只判 `existsSync(<dir>/cargo.exe)` 的形态会在「装好了」的机器上永远探不到。
 *
 * @param {{env?: Record<string, string | undefined>, home?: string}} [deps] `env` 与
 *   `home` 都可注入（默认 `process.env` 与 `os.homedir()`）—— 用例据此把「另一台机器」
 *   造出来，不碰真用户的 `~/.cargo` / `~/.rustup`
 * @returns {CargoLookup} `path` = cargo 的绝对路径（PATH 与各安装位都没有 = `null`）
 */
export function findCargoLookup({
  env = process.env,
  home = os.homedir(),
} = {}) {
  /** @type {CargoProbe[]} */
  const probes = [];

  const onPath = whichCommand("cargo", { env });
  if (onPath) {
    probes.push({ where: "PATH", result: "hit", detail: onPath });
    return { path: onPath, probes };
  }
  probes.push({ where: "PATH", result: "absent" });

  /* 两处候选**按条件拼**（而不是先塞一个 `false` 再 filter 掉）：`CARGO_HOME` 未设时
   * `process.env.CARGO_HOME && …` 求值成 `false`，数组就成了 `(string | false)[]`，
   * 而 `.mjs` 里写不了 `dir is string` 这种谓词（TS8010：类型注解只许出现在 `.ts`），
   * tsc 也不会从 `typeof dir === "string" && dir.length > 0` 里推 —— 结果是下面整段
   * 都带着 `string | undefined` 用。改成按条件拼之后类型本身就是 `string[]`，
   * 不用靠注解断言。 */
  /** @type {{dir: string, where: string}[]} */
  const candidates = [];
  /* 取证那一行要念**原始值**，不是解出来的绝对路径：跨平台的值（Linux 上跑门禁、
   * 而 `CARGO_HOME` 是 Windows 形态）会被 `path.resolve` 解成 `<cwd>/G:\.cargo`，
   * 那一行就与平台上真正配着的值对不上了 —— 判据（「不在」）不变，读的人却会走错路。 */
  const cargoHomeRaw = (env.CARGO_HOME ?? "").trim().replace(/^"(.*)"$/, "$1");
  const cargoHome = cargoHomeValue(env);
  if (cargoHome) {
    candidates.push({
      dir: path.join(cargoHome, "bin"),
      where: `CARGO_HOME/bin（${cargoHomeRaw}）`,
    });
  }
  /* rustup 自己记着 cargo 装在哪（`settings.toml` 的 `cargo_home`）—— 这是**变量之外**
   * 的事实来源，`CARGO_HOME` 没传进来时唯一还说得出的落点（ISSUE #2374）。 */
  const rustupCargoHome = rustupCargoHomeValue({ env, home });
  if (rustupCargoHome) {
    candidates.push({
      dir: path.join(rustupCargoHome, "bin"),
      where: `rustup 记着的 cargo_home/bin（${rustupCargoHome}）`,
    });
  }
  /* `~/.cargo/bin` 按**两个**家目录各问一次：`os.homedir()` 与用户环境变量指的不是
   * 同一个地方时（服务账号 / 自托管 runner / `HOME` 被改过），只有其中一处是真的。 */
  for (const { dir, where } of cargoBinHomes({ env, home })) {
    candidates.push({ dir, where });
  }
  candidates.push({
    dir: path.join(home, ".rustup", "toolchains"),
    where: "~/.rustup/toolchains",
  });

  for (const { dir, where } of candidates) {
    if (dir.endsWith("toolchains")) {
      // rustup 的每个工具链各有一份 cargo：取版本号最大的那个（字典序即版本序，
      // 1.10 与 1.9 这种少见形态不在此纠偏 —— 只认「挑不到就继续找下一处」。
      /** @type {string[]} */
      let versions;
      try {
        versions = fs.readdirSync(dir).sort().reverse();
      } catch (err) {
        // 目录不存在 = 这一处没有，接着看下一处（不是「探到但不可用」）；
        // 读不了（没权限 / 不是目录）必须分开记 —— 那要人去查权限，不是去装 rustup。
        probes.push(
          isAbsentError(err)
            ? { where, result: "absent" }
            : { where, result: "unreadable", detail: errorCode(err) },
        );
        continue;
      }
      if (versions.length === 0) {
        probes.push({ where, result: "empty", detail: "目录在，但没有工具链" });
        continue;
      }
      for (const version of versions) {
        const found = probeCargoIn(path.join(dir, version, "bin"));
        if (found.ok) {
          probes.push({ where, result: "hit", detail: found.detail });
          return { path: found.path, probes };
        }
      }
      probes.push({
        where,
        result: "absent",
        detail: `${versions.length} 个工具链里都没有 bin/${cargoExeName()}`,
      });
      continue;
    }
    const found = probeCargoIn(dir);
    if (found.ok) {
      probes.push({ where, result: "hit", detail: found.detail });
      return { path: found.path, probes };
    }
    probes.push({ where, result: found.result, detail: found.detail });
  }
  return { path: null, probes };
}

/**
 * 在一个目录里找 `cargo`：**先用 fs 判，再用 dir 本身交叉确认**。
 *
 * ── 为什么不只是 `fs.existsSync(<dir>/cargo.exe)`（ISSUE #2368 的平台现场）──────
 *
 * 平台 runner 的 `CARGO_HOME` 是 `G:\.cargo`，而 `G:` 是 **subst 出来的盘符**
 * （`docs/guides/dev-drive-refs.md`；runner 的检出也在 `G:`）。Node 的 `fs` 走
 * **Win32 long-path 前缀**（`\\?\G:\…`），而 subst 映射是**每登录会话**的 —
 * 判据以服务账号跑，那一前缀解释不出别的会话里的映射 ⇒ 同一份 cargo 对 `fs`
 * **不存在**、对 `Get-Command` 存在。表现是「装好了、探不到」，整格按「没跑起来」收。
 *
 * 所以回退面的判据退一步问两件事：**这个目录在不在**，以及**目录里有没有这个名字**。
 * `readdirSync` 走的是同一条路径、同样可能被 subst 骗，因此 `statSync` 失败时
 * 还要判「错误码是 ENOENT 还是别的」—— 只有「目录确实不在」（ENOENT）才算 absent；
 * 其余（EPERM / EBUSY / 判据自己根本没走到）一律按 `unreadable` 记，让人去查权限，
 * 而不是去装第二遍工具链。
 *
 * `detail` 里带**目录读数**（有几项、有没有那个名字）：取证那一行于是说得出
 * 「这条路存在吗、里面有什么」，而不是一句 `absent`。
 *
 * @param {string} dir 候选目录（`<CARGO_HOME>/bin` 或某个工具链的 `bin`）
 * @returns {{ok: true, path: string, detail: string} | {ok: false, result: "absent" | "empty" | "unreadable", detail: string}}
 */
export function probeCargoIn(dir) {
  const exe = path.join(dir, cargoExeName());
  if (fs.existsSync(exe)) return { ok: true, path: exe, detail: exe };
  /** @type {string[]} */
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    const code = errorCode(err);
    return isAbsentError(err)
      ? { ok: false, result: "absent", detail: `${exe}（目录不在）` }
      : {
          ok: false,
          result: "unreadable",
          detail: `${code ?? "读不了"} —— ${dir}`,
        };
  }
  /* 目录在、而名字不在：把「像 cargo 的那几个」念出来（含 `.exe` 有无两种形态）。
   * 一条都没有时说清是空目录 —— 那与「文件在但被 fs 骗了」是两种下一步。 */
  const like = names.filter((n) => n.toLowerCase().startsWith("cargo"));
  return {
    ok: false,
    result: like.length > 0 ? "unreadable" : "empty",
    detail:
      like.length > 0
        ? `目录里有 ${like.join(" / ")}，但 \`fs\` 判 ${cargoExeName()} 不存在（subst 盘上的假阴性？）—— ${dir}`
        : `目录在（${names.length} 项），但没有 ${cargoExeName()} —— ${dir}`,
  };
}

/**
 * `findCargo()`：只要落点的那一半（判决面只关心「有没有、是哪一份」）。
 *
 * @param {{env?: Record<string, string | undefined>}} [deps]
 * @returns {string | null}
 */
export function findCargo(deps) {
  return findCargoLookup(deps).path;
}

/**
 * `CARGO_HOME` 读成**能拼路径的值**，读不出来就是 `null`（= 这一处不探）。
 *
 * 三件都要管，缺一件这一处就静默落空（ISSUE #2293）：
 *   · **未设 / 空串** ⇒ 没有这一处；
 *   · **环境变量里带的引号**（`CARGO_HOME="G:\.cargo"` 那种写法，值里就带着引号）
 *     先剥掉 —— 否则 `path.join` 拼出的是 `"G:\.cargo"\bin`，一个不存在的路径；
 *   · **相对路径**（`CARGO_HOME=.cargo`）按 cwd 解析成绝对路径 —— `cargo` 自己就是
 *     这么解的，而 `path.join` 出来的相对路径会被 `existsSync` 拿去问 cwd。
 * 尾部分隔符（`G:\.cargo\`）由 `path.join` 自然消化，不用特殊处理。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function cargoHomeValue(env) {
  const raw = (env.CARGO_HOME ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  if (!raw) return null;
  return path.resolve(raw);
}

/**
 * `~/.cargo/bin` 的候选（**按两个家目录各求一次**）。
 *
 * 为什么不能只问 `os.homedir()`（ISSUE #2374 的现场形状）：cargo 从 rustup 装进的是
 * **某个用户**的 `~/.cargo/bin`，而判据跑在哪个账号、`HOME` / `USERPROFILE` 指向哪儿，
 * 与那个用户不一定是同一个。三处安装位里两处都从「家」派生，家取错一次就整面落空，
 * 而落空的样子与「没装」逐字同形。
 *
 * 两处都问、按首次出现的顺序去重：真重合时只探一次（取证那行不重复念同一段路径）。
 *
 * @param {{env: Record<string, string | undefined>, home: string}} deps
 *   `home` 是 `os.homedir()` 的那一份；环境变量那份从这里读
 * @returns {{dir: string, where: string}[]}
 */
export function cargoBinHomes({ env, home }) {
  /** @type {{dir: string, where: string}[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /**
   * @param {string} base 家目录
   * @param {string} where 取证那一行怎么念这一处
   */
  const push = (base, where) => {
    const dir = path.join(base, ".cargo", "bin");
    const key = dir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ dir, where });
  };
  push(home, "~/.cargo/bin");
  /* Windows 上 `HOME` 常常没设、`USERPROFILE` 才是那个家；POSIX 上反过来。
   * 两个都看一眼，比「按平台挑一个」少一次猜错的机会。 */
  /** @type {[string, string][]} */
  const envHomes = [
    ["USERPROFILE", "USERPROFILE"],
    ["HOME", "HOME"],
  ];
  for (const [name, label] of envHomes) {
    const raw = (env[name] ?? "").trim().replace(/^"(.*)"$/, "$1");
    if (!raw) continue;
    push(path.resolve(raw), `$${label}/.cargo/bin`);
  }
  return out;
}

/**
 * rustup 自己记着的 `cargo_home`（`$RUSTUP_HOME/settings.toml` 里那一行）。
 *
 * 为什么要有这一路（ISSUE #2374）：`CARGO_HOME` 是**用户级**变量，判据所在的会话
 * （服务账号、容器、自托管 runner）里通常是空的 —— 而 cargo 就装在那个用户的
 * `~/.cargo/bin` 下。旧回退面从环境变量推「装在哪」，变量没传进来就**连一处都不探**，
 * 于是一台装好了 cargo 的机器给出「找不到 cargo」。rustup 的 `settings.toml` 是
 * 「这个用户把 cargo 装在哪」的**书面记录**，比环境变量更接近事实。
 *
 * 读不到 / 读得出但没这一行 / 值的形状不认 ⇒ `null`（这一处不探，判据一字不改）。
 * 只认 `cargo_home = "..."` 这一种行（rustup 写的就是这种），不做 TOML 解析 ——
 * 解析器要为一行配置引入一棵依赖树，而这份文件只有 rustup 自己写。
 *
 * @param {{env?: Record<string, string | undefined>, home?: string}} [deps]
 * @returns {string | null} 绝对路径，或 `null`
 */
export function rustupCargoHomeValue({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const rustupHomeRaw = (env.RUSTUP_HOME ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  const settings = path.join(
    rustupHomeRaw ? path.resolve(rustupHomeRaw) : path.join(home, ".rustup"),
    "settings.toml",
  );
  /** @type {string} */
  let text;
  try {
    text = fs.readFileSync(settings, "utf8");
  } catch {
    return null;
  }
  const line = text.split(/\r?\n/).find((l) => /^\s*cargo_home\s*=/.test(l));
  if (!line) return null;
  const raw = line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  return raw ? path.resolve(raw) : null;
}

/**
 * 这条错误是不是「那个落点根本不存在」（而不是「在、但读不了」）。
 *
 * @param {unknown} err `catch` 到的东西
 * @returns {boolean}
 */
function isAbsentError(err) {
  const code = errorCode(err);
  return code === "ENOENT" || code === undefined;
}

/**
 * 从 `catch` 到的东西里取错误码（`unknown` 收窄，不在这里 `as`）。
 *
 * @param {unknown} err
 * @returns {string | undefined}
 */
function errorCode(err) {
  if (err && typeof err === "object" && "code" in err) {
    const code = err.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** cargo 的文件名（Windows 上带 .exe；其余平台无后缀）。 */
function cargoExeName() {
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}
