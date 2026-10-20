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
import { fileURLToPath } from "node:url";

import {
  FINGERPRINT_FILE,
  pnpmInstallFingerprint,
} from "./ci-deps-face.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 槽根由环境变量给出：没配就是「不设槽」，这一档不猜路径。 */
export const CACHE_ROOT_ENV = "COMFY_CI_CACHE_ROOT";

/** 计划里三种关系的名字（会出现在平台日志里，改名等于换掉一条可 grep 的口径）。 */
export const SLOT_ACTIONS = ["reuse", "install-into-slot", "no-cache"];

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
 * 该落哪一档。**纯函数**：所有事实由调用方给（于是四档都能在用例里造出来，不需要真树）。
 *
 * 判别顺序里两条「不猜」的分支排在前面：没配槽 与 键算不出来。它们与「槽没命中」
 * 是三件不同的事，混成一档就会在「其实没配」与「配了但键变了」之间给出同一个读数。
 *
 * @param {{cacheRoot?: string | null, key?: string | null, slotPresent?: boolean, slotFingerprint?: string | null}} input
 * @returns {{action: string, path: string | null, why: string}}
 */
export function planSlot(input) {
  const { cacheRoot, key, slotPresent = false, slotFingerprint = null } = input;
  if (!cacheRoot) {
    return {
      action: "no-cache",
      path: null,
      why: `没配 ${CACHE_ROOT_ENV} —— 节点上没有跨作业活下来的目录，这一格没有槽可言`,
    };
  }
  if (!key) {
    return {
      action: "no-cache",
      path: null,
      why: "依赖面指纹算不出来（锁文件 / 配置读不到）⇒ 不拿一个猜出来的键去找槽",
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
 * 读一个槽的现状（只有两种「读不到」被区分开：目录不在 / 在但没有已装产物）。
 *
 * @param {string | null} slot @param {string} cwd 解析相对路径的基准（测试给临时目录）
 * @returns {{slotPresent: boolean, slotFingerprint: string | null}}
 */
function readSlot(slot, cwd) {
  if (!slot) return { slotPresent: false, slotFingerprint: null };
  const abs = path.resolve(cwd, slot);
  if (!fs.existsSync(abs)) return { slotPresent: false, slotFingerprint: null };
  let fp = null;
  try {
    fp = fs.readFileSync(path.join(abs, FINGERPRINT_FILE), "utf8").trim();
  } catch {
    /* 槽在但没装过（或产物被清了一半）⇒ 指纹为空，`planSlot` 会走重装那一档。 */
    fp = null;
  }
  return { slotPresent: true, slotFingerprint: fp };
}

/**
 * 入口：算键 + 出读数。恒退 0（性质见文件头）。
 *
 * @param {{cwd?: string, env?: Record<string, string | undefined>, log?: (line: string) => void}} [io]
 * @returns {number}
 */
export function main(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const cacheRoot = (env[CACHE_ROOT_ENV] ?? "").trim() || null;
  const key = pnpmInstallFingerprint(cwd);
  /* 槽路径只由「槽根 + 键」决定，不含任何磁盘事实 ⇒ 先算它、再读它的现状、最后交给
   * `planSlot` 判关系（顺序反过来就得在 plan 里再算一遍路径，那是第二份事实）。 */
  const slot = cacheRoot && key ? slotPath(cacheRoot, key) : null;
  const plan = planSlot({ cacheRoot, key, ...readSlot(slot, cwd) });
  log(
    `[缓存槽读数] 键 ${(key ?? "取不到").slice(0, 12)}·槽 ${
      cacheRoot ? cacheRoot : "未配置"
    }·结论 ${plan.action}`,
  );
  log(`[缓存槽读数]   ${plan.why}`);
  log(
    "[缓存槽读数] 这一格**只读数、不碰盘**：不复制、不链接、不装的动作全在" +
      "执行档 `ci-slot-apply.mjs` 里（规范 §13.5.3.4.3）。",
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
