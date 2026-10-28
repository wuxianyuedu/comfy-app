/**
 * 缓存槽的**键控与计划**（ISSUE #2022 第二步：读数的形状在第一增量，动作在
 * `ci-slot-apply.mjs` 第二增量）。
 *
 * 为什么分两批：这一件事的落点在 `Install dependencies` 那一格上，而那一格是**每一次
 * 构建都要过的**（它红了整条流水线就没有后面的事）。把「机制」与「换执行者」同批推上去，
 * 表现就是一次键算错让所有 PR 装不上 —— 与本仓在档位那一刀上立的同一条纪律相反：
 * 先让判据在场，再把开关拨过去。所以本文件**只回答三问、不碰盘**：
 *   ① 有没有槽（节点上是否存在一块跨作业活下来的目录 —— `工作区复用读数` 两跑实测的
 *      形态①说：没有，每个作业都是新目录，所以「缓存」的收益全在**能不能自己带一棵树**）；
 *   ② 该落哪个键；
 *   ③ 这一跑与该键的关系是 `reuse` / `install-into-slot` / `no-cache` 中的哪一档。
 *
 * 键的来源刻意复用 `ci-deps-face.mjs` 的 `pnpmInstallFingerprint`，不在这里重算一份：
 * 那份指纹已经是「装的那一次」与「现在」同一份输入的判据（锁文件 + 三份配置 + `patches/`）。
 * 两处各算一份的漂移形态是具体的 —— 缓存命中判断与「碰了依赖面就得真装」的判断不再一致，
 * 于是**装了旧的**或**没装新的**，两者的表现都是「依赖不对，但门禁全绿」。
 *
 * ⚠️ 槽必须是**能就地跑 `pnpm install` 的真实目录**，不是「把装好的树搬过来」也不是
 * 「穿过 junction 装」：实测见规范 §13.5.3.4.3（穿链装会让同一份声明经两条路径解析成
 * 两个身份、pnpm 建的是绝对内部链接换根即全断、runner 收尾那句 `Remove-Item` 实测不穿链）。
 *
 * 退出码：本档**恒 0**。它与 `工作区复用读数` 同一性质 —— 读数不是判据；把「没配槽」
 * 做成红，等于让每一次本地跑都红在一件本就不该由本地负责的事上。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { FINGERPRINT_FILE, pnpmInstallFingerprint } from "./ci-deps-face.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** 槽根由环境变量给出：没配就是「不设槽」，这一档不猜路径。 */
export const CACHE_ROOT_ENV = "COMFY_CI_CACHE_ROOT";

/** 成品目录（安装包）的根由环境变量给出；没配就从 store 所在卷推导（见 `resolveArtifactRoot`）。 */
export const ARTIFACT_ROOT_ENV = "COMFY_CI_ARTIFACT_ROOT";

/** 第三方构建工具镜像的根（见 `resolveToolRoot`）——它不是缓存，删了今天就没包。 */
export const TOOLS_ROOT_ENV = "COMFY_CI_TOOLS_ROOT";

/** 计划里三种关系的名字（会出现在平台日志里，改名等于换掉一条可 grep 的口径）。 */
export const SLOT_ACTIONS = ["reuse", "install-into-slot", "no-cache"];

/**
 * 槽根下最多留几个键。
 *
 * 为什么按「个」而不按「GB」定：实测一个槽的**表观**大小约 982 MiB / 83,664 个文件，
 * 而其中 `nlink==1` 的独占数据只有 2,599 个（3.1%）、合计 1.7 MiB —— 删掉之后磁盘
 * 实测**回收 52 MiB**（其余是目录项）。按 `du` 那个 3.5G 定配额等于把配额定成一个
 * 假数，而按「个」定，四个键的净占用不到 0.3 GiB。
 *
 * ⚠️ **这份常量的家在读数这一侧**（本文件），执行档 `ci-slot-apply.mjs` 从这里取 ——
 * 「配额是几个」这件事只能有一处，漂了之后的表现是「读数说够、执行按另一份算」，
 * 而淘汰那一刀是**会删盘**的动作。
 */
export const MAX_SLOT_KEYS = 4;

/**
 * 淘汰的 TTL 闸门（毫秒）：**比一次构建的墙钟长**，所以「正被人用」的键必然落在闸门内。
 *
 * 取 26 小时而不是 24 小时，是为了让每日那一跑（00:00）与它前后那跑不互相把对方的
 * 树删掉。
 */
export const SLOT_TTL_MS = 26 * 60 * 60 * 1000;

/** 「最近用过」的邮票文件名（内容就是一个毫秒时刻）。 */
export const SLOT_USED_FILE = ".ci-slot-used";

/**
 * 写锁的文件名 —— 「有人正在往里装」的唯一出处（执行档 `acquireSlotLock` 写它）。
 *
 * 住在读数侧是因为**空壳谓词要用它**，而那份谓词必须只有一处（见 `isUselessShell`）。
 */
export const SLOT_LOCK_FILE = ".ci-slot.lock";

/**
 * 槽目录 = `<槽根>/<键>`。
 *
 * 键是 sha256 十六进制，直接当目录名：跨作业比较只需要「同一个键 → 同一个目录」，
 * 不需要人读得出来（人读的那一份是日志里印出的键前缀）。
 *
 * @param {string} cacheRoot @param {string} key @returns {string} */
export function slotPath(cacheRoot, key) {
  return path.join(cacheRoot, key);
}

/**
 * 两个路径是否落在**同一个卷**上（Windows 上就是同一个盘符；POSIX 上恒为 `/` ⇒ 恒真）。
 *
 * 这里要判的是第二条同卷义务，第一条（与 store 同卷）管的是硬链接，这一条管**能不能用**：
 * 作业里的 `node_modules` 是指向槽的 junction，于是「往 `node_modules` 里挪一个文件」这类
 * 动作（`fs.renameSync` 那一型）在跨卷时不是变慢，是**直接失败** ——
 * 实测形态：`EXDEV: cross-device link not permitted, rename
 * '<G:>\…\workspace\.storybook\generated\app-origin.json' ->
 *  '<G:>\…\workspace\node_modules\.cache\…'`（目标穿过 junction 落在了 F: 的槽里）。
 * 红的位置在一条用例里，原因在缓存槽的选址上 —— 所以选址必须自己拦下来，
 * 不许让别人去猜（同 §13.5.3.4.3 那句「红在别处、永远指不到这一层」）。
 *
 * @param {string} a @param {string} b @returns {boolean}
 */
export function sameVolumeAs(a, b) {
  /** @param {string} p @returns {string} */
  const rootOf = (p) => {
    try {
      return path.parse(path.resolve(p)).root.toLowerCase();
    } catch {
      return "";
    }
  };
  const ra = rootOf(a);
  const rb = rootOf(b);
  return ra !== "" && ra === rb;
}

/**
 * 该落哪一档。**纯函数**：所有事实由调用方给（于是四档都能在用例里造出来，不需要真树）。
 *
 * 判别顺序里两条「不猜」的分支排在前面：没配槽 与 键算不出来。它们与「槽没命中」
 * 是三件不同的事，混成一档就会在「其实没配」与「配了但键变了」之间给出同一个读数。
 *
 * @param {{cacheRoot?: string | null, key?: string | null, slotPresent?: boolean,
 *   slotFingerprint?: string | null, sameVolume?: boolean}} input
 *   `sameVolume` = 槽根与**作业检出**是否同卷（默认 `true`，即调用方没这条事实时不拦）。
 * @returns {{action: string, path: string | null, why: string}}
 */
export function planSlot(input) {
  const {
    cacheRoot,
    key,
    slotPresent = false,
    slotFingerprint = null,
    sameVolume = true,
  } = input;
  if (!cacheRoot) {
    return {
      action: "no-cache",
      path: null,
      why: `没配 ${CACHE_ROOT_ENV}（也不是推导出来的）—— 节点上没有跨作业活下来的目录，这一格没有槽可言`,
    };
  }
  if (!key) {
    return {
      action: "no-cache",
      path: null,
      why: "依赖面指纹算不出来（锁文件 / 配置读不到）⇒ 不拿一个猜出来的键去找槽",
    };
  }
  if (!sameVolume) {
    return {
      action: "no-cache",
      path: null,
      why:
        `槽根与作业检出**不在同一卷** ⇒ 不接：作业里的 \`node_modules\` 是指向槽的链接，` +
        "跨卷时「往 node_modules 里挪一个文件」这类 rename 会直接 EXDEV 失败" +
        "（红会落在某条用例里，原因在选址上 —— 所以这里拦，不让人猜）",
    };
  }
  const slot = slotPath(cacheRoot, key);
  if (!slotPresent) {
    return {
      action: "install-into-slot",
      path: slot,
      why: "该键的槽不在（第一次，或槽根被清过）⇒ `ci-slot-apply.mjs` 会在这个目录里就地装",
    };
  }
  if (slotFingerprint !== key) {
    return {
      action: "install-into-slot",
      path: slot,
      why:
        "槽在、但它自己的指纹与本次键不一致 ⇒ 键变了或槽被别的输入用过 —— " +
        "宁可重装，也不把一套来历不明的产物接进这一跑",
    };
  }
  return {
    action: "reuse",
    path: slot,
    why: "键与槽内指纹逐字相同 ⇒ `ci-slot-apply.mjs` 把这一跑的依赖面接向它，并跳过安装",
  };
}

/**
 * 槽根 = **这个作业的工作区里 `pnpm` 自己回答的那个 store 所在的卷** 下的 `ci-cache/<包名>`。
 *
 * 不写死盘符，理由不是风格：这台机器的 runner 就在今天从 `F:` 搬到了 `G:`，而写死的
 * `F:\runner\ci-cache\…` 会跟着一起留在 F: —— 于是槽与**这个作业真正用的那个 store 跨卷**，
 * pnpm 从硬链接退化成整树复制（实测一个槽的净成本从 52 MiB 变成表观的 982 MiB）。
 * 「同卷」是这件事全部收益的前提，所以它必须是**推导出来的**，不是抄下来的。
 *
 * 为什么问 `pnpm store path` 而不是问 runner 目录或盘符：那条命令用的解析面与
 * `pnpm install` 在同一次构建里用的是**同一条**（实测随 cwd 变：从 `F:\AI\…` 答
 * `F:\.pnpm-store\v11`、从 `G:\runner` 答 `G:\.pnpm-store\v11`、从 `C:` 的用户临时目录
 * 答 `C:\Users\…\pnpm\store\v11`）。所以只要 store 搬到哪儿，槽就跟到哪儿，不需要有人
 * 记得改配置 —— 而「有人记得改」正是被删掉的那个写死值的失效方式。
 *
 * `COMFY_CI_CACHE_ROOT` 仍然优先：那是「这台机器想把缓存放到另一块盘」的显式出口，
 * 但用它的人要自己承担同卷这件事。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}} `from` 会进日志（答案与它的来源必须一起读）
 */
/**
 * 槽根的**两份事实**（卷根 + 包名）—— 依赖面那套槽与构建缓存那套槽**共用**这一份推导。
 *
 * 为什么共用：两处各问一次 `pnpm store path` 就会有两份「槽在哪」的答案，而它们必须同源
 * —— 「依赖面槽在 F:、构建缓存槽在 G:」没有任何好处，只会让人以为那是故意的
 * （§12.12：同一件事只允许一处实现）。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{explicit: string | null, volumeRoot: string | null, name: string, from: string}}
 */
function cacheRootFacts(io) {
  const env = io.env ?? {};
  const explicit = (env[CACHE_ROOT_ENV] ?? "").trim();
  if (explicit) {
    return {
      explicit,
      volumeRoot: null,
      name: "",
      from: `环境变量 ${CACHE_ROOT_ENV}`,
    };
  }
  const run = io.run;
  if (!run) {
    return {
      explicit: null,
      volumeRoot: null,
      name: "",
      from: "无 pnpm 出口 ⇒ 不猜路径",
    };
  }
  const res = run(["store", "path"], { cwd: io.cwd });
  const store = String(res?.stdout ?? "").trim();
  if ((res?.status ?? 1) !== 0 || !store) {
    return {
      explicit: null,
      volumeRoot: null,
      name: "",
      from: "问不出 store ⇒ 不设槽（宁可不省，也不猜一个卷）",
    };
  }
  let name = "repo";
  try {
    name = String(
      JSON.parse(fs.readFileSync(path.join(io.cwd, "package.json"), "utf8"))
        .name ?? "repo",
    ).toLowerCase();
  } catch {
    /* 读不到包名就用一个中性目录名 —— 它只用于区分同机上的不同仓库。 */
  }
  return {
    explicit: null,
    volumeRoot: path.parse(store).root,
    name,
    from: `由 store ${store} 所在卷推导`,
  };
}

/**
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}} `from` 会进日志（答案与它的来源必须一起读）
 */
export function resolveCacheRoot(io) {
  const facts = cacheRootFacts(io);
  if (facts.explicit) return { root: facts.explicit, from: facts.from };
  if (!facts.volumeRoot) return { root: null, from: facts.from };
  return {
    root: path.join(facts.volumeRoot, "ci-cache", facts.name),
    from: facts.from,
  };
}

/**
 * **构建缓存槽**的根（`scripts/ci-build-cache-slot.mjs` 用它）。
 *
 * 与依赖面那套槽**同卷**、不同目录（`ci-build-cache/` 而不是 `ci-cache/`）——
 * 不同目录是必须的：依赖面那套的槽目录按「依赖面指纹」命名，而它的读数与淘汰
 * （`listSlots` / `pruneSlots`）把槽根下的**每个目录**都当成一个键；构建缓存槽按
 * 「构建面指纹」命名，两套混在一个根下时，那边的淘汰会把这边正在用的目录删掉。
 *
 * ⚠️ `COMFY_CI_CACHE_ROOT`（显式出口）**只覆盖依赖面那套槽**：它的语义是「那个槽根
 * 指到哪儿去」，改成「卷根」会让已配的机器把依赖面槽整个搬走。构建缓存槽因此问不到
 * 显式出口时按推导走。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}}
 */
export function resolveBuildCacheRoot(io) {
  const facts = cacheRootFacts(io);
  if (facts.explicit) {
    return {
      root: null,
      from: `${facts.from}（该变量只覆盖依赖面那套槽，构建缓存槽不跟着它走）`,
    };
  }
  if (!facts.volumeRoot) return { root: null, from: facts.from };
  return {
    root: path.join(facts.volumeRoot, "ci-build-cache", facts.name),
    from: facts.from,
  };
}

/**
 * **成品目录**的根（`scripts/publish-desktop-bundle.mjs` 用它，ISSUE #2503）。
 *
 * 与两份缓存槽同卷、第三个目录（`ci-artifacts/<包名>`）。必须是第三个目录而不是复用
 * 前两者的根：那两套的淘汰器（`listSlots` / `pruneSlots`）把**槽根下的每个目录都当成
 * 一个键**，成品目录放进去就会出现在它们的候选集里 —— 一个 TTL 到期的键位就能把人
 * 要取的安装包删掉（而安装包不是缓存：删了就没了，缓存删了只是下一次慢）。
 *
 * 显式出口 `COMFY_CI_ARTIFACT_ROOT` 优先（与 `COMFY_CI_CACHE_ROOT` 分开：那两个变量
 * 各自只管自己那一套根，一个变量管三套就会让「搬依赖槽」顺带搬走成品，而那是两个决定）。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}}
 */
export function resolveArtifactRoot(io) {
  const explicit = String(io.env?.[ARTIFACT_ROOT_ENV] ?? "").trim();
  if (explicit) return { root: explicit, from: `环境变量 ${ARTIFACT_ROOT_ENV}` };
  const facts = cacheRootFacts(io);
  if (facts.explicit) {
    return {
      root: null,
      from: `${facts.from}（该变量只覆盖依赖面那套槽，成品目录不跟着它走）`,
    };
  }
  if (!facts.volumeRoot) return { root: null, from: facts.from };
  return {
    root: path.join(facts.volumeRoot, "ci-artifacts", facts.name),
    from: facts.from,
  };
}

/**
 * **第三方构建工具镜像**的根（`scripts/tauri-tools-cache.mjs` 用它，ISSUE #2525）。
 *
 * 与上面三套同卷、第四个目录（`ci-tools/<包名>`）。它**不是缓存**：缓存删了只是下一次慢，
 * 这一份删了那条流水线今天就打不出包 —— 所以它同样不许住在两份槽根之下（槽根的淘汰器
 * 把每个目录都当成一个键，并按 TTL 删）。
 *
 * 显式出口 `COMFY_CI_TOOLS_ROOT` 优先（与依赖槽那个变量分工一样：一个变量只管自己那一套根）。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}}
 */
export function resolveToolRoot(io) {
  const explicit = String(io.env?.[TOOLS_ROOT_ENV] ?? "").trim();
  if (explicit) return { root: explicit, from: `环境变量 ${TOOLS_ROOT_ENV}` };
  const facts = cacheRootFacts(io);
  if (facts.explicit) {
    return {
      root: null,
      from: `${facts.from}（该变量只覆盖依赖面那套槽，工具镜像不跟着它走）`,
    };
  }
  if (!facts.volumeRoot) return { root: null, from: facts.from };
  return {
    root: path.join(facts.volumeRoot, "ci-tools", facts.name),
    from: facts.from,
  };
}

/**
 * 读一个槽的现状（只有两种「读不到」被区分开：目录不在 / 在但没有已装产物）。
 *
 * @param {string | null} slot @param {string} cwd 解析相对路径的基准（测试给临时目录）
 * @returns {{slotPresent: boolean, slotFingerprint: string | null}}
 */
function readSlot(slot, cwd) {
  if (!slot) return { slotPresent: false, slotFingerprint: null };
  const abs = path.resolve(cwd, slot);
  if (!fs.existsSync(abs)) return { slotPresent: false, slotFingerprint: null };
  let fp;
  try {
    fp = fs.readFileSync(path.join(abs, FINGERPRINT_FILE), "utf8").trim();
  } catch {
    /* 槽在但没装过（或产物被清了一半）⇒ 指纹为空，`planSlot` 会走重装那一档。 */
    fp = null;
  }
  return { slotPresent: true, slotFingerprint: fp };
}

/**
 * 这个槽最近什么时候被用过（读不到 ⇒ `null`，而 `null` 一律**不淘汰**）。
 *
 * 那是**「用过」的唯一出处**：接槽是在**作业**里建一条 junction，根本不碰槽目录
 * 那一层；运行期的写入（`.vite` 之类）落在 `node_modules` 里面，也不碰槽根的 mtime。
 * 于是「天天被命中的热键」按 mtime 看可能最旧 —— 按 mtime 淘汰会**删掉另一个作业
 * 正在用的树**，那一个构建的依赖当场消失。
 *
 * @param {string} slot
 * @returns {number | null}
 */
export function slotLastUsed(slot) {
  try {
    const n = Number(
      fs.readFileSync(path.join(slot, SLOT_USED_FILE), "utf8").trim(),
    );
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * 槽的现状 —— 三格分开，尤其不许把「指纹文件在、但这一趟读不动」读成「键变了」。
 *
 * 这条区分是**打开开关的前提**：判成「键变了」会走重装，而重装在失败时把那棵树删掉。
 * 并发作业时那棵树可能正被另一个作业**接在上面**（它读到了匹配的指纹才接的），
 * 于是一次 `EBUSY`（Windows 上另一进程正在写那个文件时的既定形态）的代价是
 * 把别人正在用的依赖树删了 —— 那比「这一跑没省到时间」重得多。
 *
 * @param {string} slot
 * @returns {{treePresent: boolean, fingerprint: string | null, unreadable: boolean}}
 */
export function readSlotState(slot) {
  const treePresent = fs.existsSync(path.join(slot, "node_modules"));
  const file = path.join(slot, FINGERPRINT_FILE);
  let exists = false;
  try {
    exists = fs.existsSync(file);
  } catch {
    /* `existsSync` 自己不抛；留着是为了形状一致，读不动照样落到下面那一格。 */
  }
  if (!exists) return { treePresent, fingerprint: null, unreadable: false };
  try {
    return {
      treePresent,
      fingerprint: fs.readFileSync(file, "utf8").trim(),
      unreadable: false,
    };
  } catch {
    return { treePresent, fingerprint: null, unreadable: true };
  }
}

/**
 * 这个槽是不是一个**没人要的空壳**（崩在半路的安装留下的那种）。
 *
 * 三个条件缺一不可：
 * - **没有产物也没有指纹** —— 里面没有可用依赖树 ⇒ 没有任何作业会命中它；
 * - **没有锁** —— 锁是「有人正在往里装」的唯一出处（`acquireSlotLock` 写的）；
 * - **目录 mtime 过了 TTL** —— 「建目录」与「拿锁」之间有一个窗口，一个刚建出来的
 *   空目录不该被当成垃圾。
 *
 * ⚠️ **mtime 在这一档里是可用的**，而在「按最近使用淘汰」那一档里不可用 ——
 * 差别在于**这一档只判空壳**：没有产物的目录里没有任何东西值得保护，而目录自己
 * 的 mtime 就是「它从哪儿来」的证据。上一档（按 mtime 做 LRU）栽的坑是
 * 「天天被命中的热键看起来最旧」—— 那是在**有产物**的目录上按 mtime 排序。
 *
 * ⚠️ **谓词只有这一份，且住在读数侧**：执行档 `ci-slot-apply.mjs` 的 `pruneSlots`
 * 从这里 import，读数 `listSlots` 也用它。依赖方向本来就是执行 → 读数（反过来成环）。
 * 两处各写一份的形状是「读数说这几个被 TTL 挡着、执行却把它们无条件回收」——
 * 两句结论会在同一份盘上同时打印出来（ISSUE #2494 的现场）。
 *
 * @param {string} abs 槽目录的绝对路径
 * @param {number} now @param {number} ttlMs
 * @param {{treePresent: boolean, fingerprint: string | null, unreadable: boolean}} [state]
 *   调用方已经读过现状时传进来，省掉同一趟的第二次读（`readSlotState`）
 * @returns {boolean}
 */
export function isUselessShell(abs, now, ttlMs, state = readSlotState(abs)) {
  /* 有产物、有指纹、或读不动 ⇒ 一律不碰（读不动尤其不能碰：那是「不知道」）。 */
  if (state.treePresent || state.fingerprint !== null || state.unreadable) {
    return false;
  }
  try {
    if (fs.existsSync(path.join(abs, SLOT_LOCK_FILE))) return false;
  } catch {
    return false;
  }
  let mtime;
  try {
    mtime = fs.statSync(abs).mtimeMs;
  } catch {
    return false;
  }
  return now - mtime >= ttlMs;
}

/**
 * 槽根下**现在**有什么 —— 配额那一格读数的唯一出处。
 *
 * ## 它答的是哪一问
 *
 * 「键数有没有上限」这件事此前**只有执行面、没有读数面**：淘汰发生在
 * `ci-slot-apply.mjs` 里，而日志上只有一句「淘汰 N 个·超配额但留着 M 个」。
 * 于是「现在到底有几个键、超额的那几个是被 TTL 挡着还是真淘汰了」在日志里读不出来 ——
 * 而这一问正是「键无上限」这句话的落点。
 *
 * ## 四档读数各自是什么意思
 *
 * - `count` —— 槽根下有几个键目录；
 * - `overQuota` —— 超出配额的那几个（配额按「个」定，见 `MAX_SLOT_KEYS`）。口径是
 *   **这一跑之后**：配额的最后一格留给当前键，当前键已在盘上时不再重复占一格
 *   （`pruneSlots` 在入口处就剔掉了它，读数必须与执行同口径 —— ISSUE #2490）；
 * - `heldByTtl` —— 超额里**执行档真会因为 TTL 留着**的那几个（它们还在闸门内 ⇒ 可能正被人用，
 *   **用空间换正确性**，方向只许这么换）；**空壳不算** —— 执行档对空壳无条件回收
 *   （`isUselessShell`），把空壳数进来就是「读数说被挡着、执行却删了」（ISSUE #2494）；
 * - `emptyCount` —— **里面没有产物也没有指纹**的那几个（崩在半路的安装留下的空壳；
 *   它们既不好用、也永远不会自己好起来 —— 执行档那一档就是专门回收它们的）；
 * - `currentOnDisk` —— 当前键在不在盘上。打印那一行靠它把「键数 ≤ 配额却报超额」
 *   解释清楚：未落盘时当前键还要占一格。
 *
 * @param {{cacheRoot: string, now?: number, ttlMs?: number, quota?: number,
 *   currentKey?: string | null}} io
 * @returns {{
 *   root: string, quota: number, count: number, overQuota: number, heldByTtl: number,
 *   emptyCount: number, currentOnDisk: boolean,
 *   keys: Array<{key: string, lastUsed: number | null, expired: boolean,
 *     uselessShell: boolean, usable: boolean, unreadable: boolean}>,
 * }}
 */
export function listSlots(io) {
  const {
    cacheRoot,
    now = Date.now(),
    ttlMs = SLOT_TTL_MS,
    quota = MAX_SLOT_KEYS,
    currentKey = null,
  } = io;
  const empty = {
    root: cacheRoot,
    quota,
    count: 0,
    overQuota: 0,
    heldByTtl: 0,
    emptyCount: 0,
    currentOnDisk: false,
    keys: [],
  };
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return empty;
  }
  const keys = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const abs = path.join(cacheRoot, e.name);
      const lastUsed = slotLastUsed(abs);
      const state = readSlotState(abs);
      return {
        key: e.name,
        lastUsed,
        expired: lastUsed !== null && now - lastUsed >= ttlMs,
        uselessShell: isUselessShell(abs, now, ttlMs, state),
        usable: state.treePresent || state.fingerprint !== null,
        unreadable: state.unreadable,
      };
    })
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
  const currentOnDisk = currentKey !== null && keys.some((k) => k.key === currentKey);
  /* 与 `pruneSlots` 同口径：当前键先剔出候选、再按 `quota - 1` 切。
   * 只扣预算不剔候选时，当前键最旧的那份盘会被算成「超额」（执行档却永远不删它）——
   * ISSUE #2490。 */
  const candidates = currentOnDisk
    ? keys.filter((k) => k.key !== currentKey)
    : keys;
  const budget = Math.max(0, quota - (currentKey ? 1 : 0));
  const over = candidates.slice(budget);
  return {
    root: cacheRoot,
    quota,
    count: keys.length,
    overQuota: over.length,
    /* 空壳不算「被 TTL 挡着」：执行档看的是同一份谓词，而它对这些目录**不看配额与邮票**地回收
       （ISSUE #2494 —— 两处各算一份时，这两个数会在同一份盘上给出相反的话）。 */
    heldByTtl: over.filter((k) => !k.uselessShell && !k.expired).length,
    emptyCount: keys.filter((k) => !k.usable).length,
    currentOnDisk,
    keys,
  };
}

/**
 * 入口：算键 + 出读数。恒退 0（性质见文件头）。
 *
 * @param {{cwd?: string, env?: Record<string, string | undefined>, log?: (line: string) => void,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} [io]
 *   `run` 是问 `pnpm store path` 的那条出口 —— 用例注入它，就不必真起一次 pnpm。
 * @returns {number}
 */
export function main(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const run = io.run ?? ((args, opts) => runPnpmSync(args, opts));
  const resolved = resolveCacheRoot({ cwd, env, run });
  const cacheRoot = resolved.root;
  log(`[缓存槽读数] 槽根来源：${resolved.from}`);
  const key = pnpmInstallFingerprint(cwd);
  /* 槽路径只由「槽根 + 键」决定，不含任何磁盘事实 ⇒ 先算它、再读它的现状、最后交给
   * `planSlot` 判关系（顺序反过来就得在 plan 里再算一遍路径，那是第二份事实）。 */
  const slot = cacheRoot && key ? slotPath(cacheRoot, key) : null;
  const plan = planSlot({
    cacheRoot,
    key,
    sameVolume: cacheRoot ? sameVolumeAs(cacheRoot, cwd) : true,
    ...readSlot(slot, cwd),
  });
  log(
    `[缓存槽读数] 键 ${(key ?? "取不到").slice(0, 12)}·槽 ${
      cacheRoot ? cacheRoot : "未配置"
    }·结论 ${plan.action}`,
  );
  log(`[缓存槽读数]   ${plan.why}`);
  if (cacheRoot) {
    const slots = listSlots({ cacheRoot, currentKey: key });
    const current =
      key === null
        ? "未知"
        : slots.currentOnDisk
          ? "已在盘上"
          : "未落盘（它要占一格）";
    log(
      `[缓存槽读数] 键数 ${slots.count}（配额 ${slots.quota}）·超配额 ${slots.overQuota} 个` +
        `（其中被 TTL 挡着 ${slots.heldByTtl} 个 ⇒ 它们可能正被人用，这是用空间换正确性；` +
        `空壳不在其中，执行档无条件回收它们）` +
        `·空槽 ${slots.emptyCount} 个·当前键${current}`,
    );
    log(
      "[缓存槽读数]   配额按「个」定：一个键的**净**盘约 52 MiB（表观 ~1 GB 里绝大部分是" +
        "与 store 共享的硬链接），所以该管的是键数而不是表观体积。",
    );
  }
  log(
    "[缓存槽读数] 这一格**只读数、不碰盘**：不复制、不链接、不装、不删的动作全在" +
      "执行档 `ci-slot-apply.mjs` 里（规范 §13.5.3.4.3）。",
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === import.meta.filename
) {
  process.exit(main());
}
