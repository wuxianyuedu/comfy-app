#!/usr/bin/env node
/**
 * node-engines.mjs — 「这台机器上的 Node 够不够新」这一格的**唯一实现**。
 *
 * ── 为什么要补这一格 ──────────────────────────────────────────────────
 *
 * 依赖链上有几份互不相同的 Node 下限，而仓库此前一份都没接住：
 *
 *   · `next` 自己要 `>=20.9.0`（所以 Node 20 上 `pnpm dev` 与 `next build` **照常跑**）；
 *   · `vitest` 要 `^22.12.0 || ^24.0.0 || >=26.0.0`、`msw` 要 `>=22.12.0`、
 *     `jsdom` 要 `^22.22.2 || ^24.15.0 || >=26.0.0`、`eslint` 要 `^20.19.0 || ^22.13.0 || >=24`、
 *     `@sentry/nextjs` 还带上界（`>=22.12.0 <23.0.0` 那一档）。
 *
 * 叠起来的表现是**最坏那一种**：低版本 Node 上开发链路全绿、只有测试档炸，
 * 而报错是 `Cannot find module` / `Failed to start forks worker` 之类的形状，
 * 指不出「你该换 Node」。本模块把这件事变成一条可读结论 + 一个可判的不变量。
 *
 * ── 判据只有一份，数字不手抄 ──────────────────────────────────────────
 *
 * 下限的**数字不在这里写死**：`engines.node` 由 `package.json` 声明，而它够不够用是
 * **从已安装依赖各自的 `engines` 现算**（`collectDependencyFloors()`）。于是升某个依赖、
 * 把它的 Node 下限抬上去时，本仓的声明若没跟着走就会红 —— 这正是「手抄的版本号会烂」
 * 那一族的机器解法（与 §12.14 端点收口、§13.5.13 依赖新鲜度同一手法）。
 *
 * 消费方两处：`scripts/check-pnpm-available.mjs`（`pnpm check:toolchain` 的人话那一面）
 * 与 `tests/dev-launcher-toolchain-gate.test.ts`（不变量的判据那一面）。机制落档 §2.1.8。
 *
 * ── 范围形状的边界（说清不装）────────────────────────────────────────
 *
 * 只解析这一族实际用到的形状：`^X.Y.Z`、`>=X.Y[.Z]`、`>X.Y[.Z]`、`<=X.Y[.Z]`、`<X.Y[.Z]`、
 * `=X.Y.Z`，加 `||` 并集与一档内并排多个比较符（AND）；操作符与版本号之间的空格先吃掉。
 * 读不懂的形状（如 `20.x`、pre-release 段、`0.x` 的 caret）**返回 `null`**，由调用方转成
 * 「没跑起来」而不是「判绿」—— 与 `merged-side-loss-git.mjs` 同一口径（§11.23.6.2）。
 * ⚠️ 独立上界（`>=22.12.0` 这类有下界 OK，但 `<23.0.0` 这种**无下界**的单独一段）**也返回
 * `null`**（下界缺失 ⇒ 整条 `parseRange` 退 null）—— 方向是 fail-closed（漏判成「没跑起来」
 * 而非「放行」），但文档上别把它写成「支持 `<X.Y`」：它是读不懂的形状之一。
 *
 * ── 为什么手写、不引 `semver` ───────────────────────────────────────
 *
 * 两条都站得住，且互相独立：
 *   ① **自举性**：本文件被 `check-pnpm-available.mjs` 在「装依赖之前」那一步调用
 *      （`.cnb.yml` 的 `Install dependencies` 里它排在 `ci-install-deps.mjs` 之前，是
 *      前提步骤），即「环境还没装好」时它就得能跑——一旦 `import "semver"`，node_modules
 *      缺失 / 损坏 / 版本装错时检查脚本自己先崩，而那恰是它最该跑的时机。
 *   ② **三态语义**：`semver.satisfies()` 只给 `boolean`——「读不懂」和「不满足」都是 `false`；
 *      本文件 `satisfies()` 给 `true | false | null`，**拒解**是第三态（`20.x` / `^0.2.3` /
 *      `*` 一律 `null`，由调用方转成「没跑起来」而非「判绿」）。semver 给不出这个，它永远
 *      会返回一个 bool。这是主动收紧，不是省依赖。
 *   ⚠️「少一个依赖」**不是**理由：`semver` 自身零依赖、约 15KB，且 npm 几乎必带一份——
 *      以「减依赖」为名手写它等于没减到任何东西。
 *
 * @module scripts/node-engines — Node 版本范围的解析、满足判定与「声明被每条依赖接受」判据
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * 一个可比较的版本三元组。
 * @typedef {[number, number, number]} Triple
 */

/**
 * 范围并集里的一段区间（`upper === null` 表示无上界）。
 * @typedef {{lower: Triple, lowerInclusive: boolean, upper: Triple | null, upperInclusive: boolean}} Interval
 */

/**
 * 一条依赖声明的 Node 范围。
 * @typedef {{pkg: string, range: string}} DependencyFloor
 */

const TRIPLE_RE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;
const COMPARATOR_RE = /^(?<op>\^|>=|<=|>|<|=)?\s*(?<version>\d+(?:\.\d+){0,2})$/;

/**
 * 严格三段版本；pre-release 与更松的形状一律拒解（见模块头）。
 * `raw` 按**可缺**写：它读的是 `package.json` / `engines` / 运行时版本号那几处外部值，
 * 缺一栏就是「读不懂 ⇒ 没跑起来」那一支（`?? ""` 之后正则不命中，回 `null`）。
 *
 * @param {string | null | undefined} raw
 * @returns {Triple | null}
 */
function parseVersion(raw) {
  const m = TRIPLE_RE.exec(String(raw ?? "").trim());
  if (!m) {
    return null;
  }
  const g = m.slice(1, 4).map(Number);
  return /** @type {Triple} */ ([g[0], g[1], g[2]]);
}

/**
 * 只给主次的补成 `.0`，便于与三元组比较。
 * @param {string | null | undefined} raw
 * @returns {Triple | null}
 */
function parseBound(raw) {
  const parts = String(raw ?? "")
    .trim()
    .split(".")
    .map(Number);
  if (!parts.length || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  while (parts.length < 3) {
    parts.push(0);
  }
  const t = parts.slice(0, 3);
  return /** @type {Triple} */ ([t[0], t[1], t[2]]);
}

/**
 * 三元组比较：a<b 给负、相等 0、a>b 给正。
 * @param {Triple} a @param {Triple} b @returns {number}
 */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return (a[i] ?? 0) - (b[i] ?? 0);
    }
  }
  return 0;
}

/**
 * 把一段 semver 范围解析成「区间的并集」。
 *
 * `range` 按**可缺**写：它来自 `package.json` 的 `engines` / 依赖的 `engines` 字段，
 * 缺这一栏就是「读不懂 ⇒ 没跑起来」那一支。
 *
 * @param {string | null | undefined} range 形如 `^22.22.2 || ^24.15.0 || >=26.0.0`
 * @returns {Interval[] | null} 解析不动给 `null` —— **不是**空数组：
 *   空数组会被调用方读成「谁都不满足」，而 `null` 读成「这条判据没跑起来」。
 */
export function parseRange(range) {
  /* 真实世界里 `>= 10`（操作符后带空格）与 `>=22.12.0 <23.0.0`（一档内并排）都在，
   * 先把操作符后面的空格吃掉，否则 `>=` 与 `10` 会被拆成两个比较符、整条读不懂。 */
  const normalized = String(range ?? "").replaceAll(/(?<op>\^|>=|<=|>|<|=)\s+/g, "$<op>");
  const alternatives = normalized
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);
  if (alternatives.length === 0) {
    return null;
  }

  /** @type {Interval[]} */
  const out = [];
  for (const alt of alternatives) {
    /* 一个 Alternative 内多个比较符是 AND：下界取最高、上界取最低；
     * 边界同值时「开」赢（同时给 `>=20` 与 `>20` 只能是 `>20`）。 */
    /** @type {Triple | null} */ let lower = null;
    let lowerInclusive = true;
    /** @type {Triple | null} */ let upper = null;
    let upperInclusive = false;

    /** @param {Triple} v @param {boolean} inclusive */
    const raiseLower = (v, inclusive) => {
      if (lower === null) {
        lower = v;
        lowerInclusive = inclusive;
        return;
      }
      const c = compareVersions(v, lower);
      if (c > 0) {
        lower = v;
        lowerInclusive = inclusive;
      } else if (c === 0 && !inclusive) {
        lowerInclusive = false;
      }
    };
    /** @param {Triple} v @param {boolean} inclusive */
    const lowerUpper = (v, inclusive) => {
      if (upper === null) {
        upper = v;
        upperInclusive = inclusive;
        return;
      }
      const c = compareVersions(v, upper);
      if (c < 0) {
        upper = v;
        upperInclusive = inclusive;
      } else if (c === 0 && !inclusive) {
        upperInclusive = false;
      }
    };

    for (const c of alt.split(/[\s,]+/).filter(Boolean)) {
      const m = COMPARATOR_RE.exec(c);
      if (!m) {
        return null;
      }
      /* `m[1]` 是可缺分组（操作符可以省），`m[2]` 在「只写了操作符」那一支上是
       * undefined —— 两处的 `??` / `if (!rawVersion)` 都是真的，规则不建模正则分组。 */
      /* `m[1]` 是可选分组（操作符可省），运行时**真的**可能是 undefined；规则侧把
       * `RegExpExecArray` 的索引读成非空（连 `.ts` 里也一样，实测过），按 §5.10 的 C 格落账。 */
      const op = m[1] ?? "=";
      const rawVersion = m[2];
      if (!rawVersion) {
        return null;
      }
      const v = parseBound(rawVersion);
      if (!v) {
        return null;
      }
      if (op === "^") {
        /* ^X.Y.Z ⇒ >=X.Y.Z 且 <(X+1).0.0（X>0 时）。0.x 另有语义，本族用不到 ⇒ 拒解。 */
        if (v[0] === 0) {
          return null;
        }
        raiseLower(v, true);
        lowerUpper(/** @type {Triple} */ ([v[0] + 1, 0, 0]), false);
      } else if (op === ">=") {
        raiseLower(v, true);
      } else if (op === ">") {
        raiseLower(v, false);
      } else if (op === "<=") {
        lowerUpper(v, true);
      } else if (op === "<") {
        lowerUpper(v, false);
      } else {
        /* `=X.Y.Z` 与「操作符缺省」都走这里。**不写 `op === "="` 那一支**：
         * `COMPARATOR_RE` 已经把取值集定死，那个比较在类型上恒真（实测被判 no-overlap），
         * 而它的语义与这里的兜底完全一致。 */
        raiseLower(v, true);
        lowerUpper(v, true);
      }
    }
    /* 走到这里 `lower` 已被 `raiseLower` 赋过值（每个合法比较符都调它），所以这一句
     * 在规则眼里恒假 —— 但它守的是「只有上界的区间」那一种形状（`parseRange` 明确
     * 不接受它，回 null 而不是拼一个下界为空的区间）。判空的必要性在**契约**上，
     * 按 §5.10 的 C 格留注释。 */
    if (lower === null) {
      return null;
    }
    out.push({ lower, lowerInclusive, upper, upperInclusive });
  }
  return out;
}

/**
 * 某个版本是否落在范围的并集里。
 *
 * @param {string | null | undefined} version 形如 `24.20.0`（也接受 `v24.20.0`）
 * @param {string | Interval[] | null | undefined} range 范围字符串，或已解析好的区间数组
 * @returns {boolean | null} `null` = 读不懂（调用方转成「没跑起来」）
 */
export function satisfies(version, range) {
  const v = parseVersion(String(version ?? "").replace(/^v/, ""));
  if (!v) {
    return null;
  }
  const intervals = Array.isArray(range) ? range : parseRange(range);
  if (!intervals) {
    return null;
  }
  return intervals.some((iv) => {
    const lowOk = iv.lowerInclusive
      ? compareVersions(v, iv.lower) >= 0
      : compareVersions(v, iv.lower) > 0;
    if (!lowOk) {
      return false;
    }
    if (iv.upper === null) {
      return true;
    }
    return iv.upperInclusive ? compareVersions(v, iv.upper) <= 0 : compareVersions(v, iv.upper) < 0;
  });
}

/**
 * 内区间是否整段落在外区间里。
 * @param {Interval} inner @param {Interval} outer @returns {boolean}
 */
function within(inner, outer) {
  /* 下界包容性：inner 的下界必须落在 outer 下界「之上（含）」。
   * 同值时，inner ⊆ outer 当且仅当「outer 含边界 或 inner 不含边界」——
   * 即 `(outer.lowerInclusive || !inner.lowerInclusive)`；写成
   * `(!outer.lowerInclusive || inner.lowerInclusive)` 是反的（实测 4 行中 2 行错：
   * outer `>20`、inner `>=20` 是真实 gap，旧式会误报 true 放过）。
   * 现网形状两端皆 inclusive（^ 与 >=），故此前休眠；一旦写 `>26.0.0` 即活。 */
  const lowCmp = compareVersions(inner.lower, outer.lower);
  const lowOk = lowCmp > 0 || (lowCmp === 0 && (outer.lowerInclusive || !inner.lowerInclusive));
  if (!lowOk) {
    return false;
  }
  if (outer.upper === null) {
    return true;
  }
  if (inner.upper === null) {
    return false;
  }
  const upCmp = compareVersions(inner.upper, outer.upper);
  if (upCmp < 0) {
    return true;
  }
  if (upCmp > 0) {
    return false;
  }
  return inner.upperInclusive === false || outer.upperInclusive === true;
}

/**
 * 「inner 的范围是否被 outer 接受」＝ inner 的每个区间都能装进 outer 的某一区间。
 *
 * 本仓要用的方向是 `covers(dep.range, declared)`：**声明必须是每条依赖范围的子集**。
 * 别记反 —— `next` 自己写的是无上界 `>=20.9.0`，反过来判会永远不成立；
 * 而写成 `>=24.15.0` 这种「看着很新」的无上界声明同样不合法（它放进依赖不收的 25.x）。
 *
 * @param {string | Interval[]} outer 接受方（依赖声明的 `engines.node`）
 * @param {string | Interval[]} inner 被检查方（本仓声明）
 * @returns {boolean | null} `null` = 有一侧读不懂
 */
export function covers(outer, inner) {
  const outerIntervals = Array.isArray(outer) ? outer : parseRange(outer);
  const innerIntervals = Array.isArray(inner) ? inner : parseRange(inner);
  if (!outerIntervals || !innerIntervals) {
    return null;
  }
  return innerIntervals.every((iv) => outerIntervals.some((o) => within(iv, o)));
}

/**
 * 扫已安装依赖各自声明的 `engines.node`。
 *
 * 只扫 `package.json` 里**声明过**的依赖（含 devDependencies）—— 那才是「装这个仓库的人
 * 会碰到的下限」。解不到的（可选 peer、按平台才装的包）跳过；但**一个都没解析到**时
 * 整单判「没跑起来」，否则「零命中」会长得像「所有依赖都不挑 Node」。
 *
 * @param {string} root 仓库根
 * @returns {{ok: true, floors: DependencyFloor[], resolvedCount: number} | {ok: false, reason: string}}
 */
export function collectDependencyFloors(root) {
  const pkg = readJson(path.join(root, "package.json"));
  if (!pkg) {
    return { ok: false, reason: "读不到 package.json" };
  }
  const declared = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  });
  if (declared.length === 0) {
    return { ok: false, reason: "package.json 里没有依赖声明" };
  }

  const requireFromRoot = createRequire(path.join(root, "noop.js"));
  /** @type {DependencyFloor[]} */
  const floors = [];
  let resolved = 0;
  for (const name of declared) {
    let manifest = null;
    try {
      manifest = requireFromRoot.resolve(`${name}/package.json`);
    } catch {
      /* 包装了但 `exports` 不暴露 `./package.json` 时 `require.resolve` 会抛 ——
       * 退回直接读盘，否则它会静默退出扫描范围（`continue` 既不计入 resolved、
       * 也不算失败，只有全部失败才判红 ⇒ 部分依赖悄悄漏扫）。 */
      const direct = path.join(root, "node_modules", name, "package.json");
      if (fs.existsSync(direct)) {
        manifest = direct;
      }
    }
    if (!manifest) {
      continue;
    }
    resolved++;
    const json = readJson(manifest);
    const range = json?.engines?.node;
    if (typeof range === "string" && range.trim()) {
      floors.push({ pkg: name, range: range.trim() });
    }
  }
  if (resolved === 0) {
    return {
      ok: false,
      reason: "一个依赖的 package.json 都没解析到（依赖没装？）",
    };
  }
  floors.sort((a, b) => a.pkg.localeCompare(b.pkg));
  return { ok: true, floors, resolvedCount: resolved };
}

/**
 * @typedef {{ok: boolean, kind: string, range?: string, gaps?: DependencyFloor[], reason?: string}} FloorVerdict
 */

/**
 * 本仓声明的范围**是否被每个依赖接受**（方向见 `covers()` 的说明）。
 *
 * @param {{root?: string, declared?: string, floors?: DependencyFloor[]}} input
 *   不给 `declared` 时从 `root/package.json` 的 `engines.node` 读。
 * @returns {FloorVerdict}
 */
export function checkDeclaredFloor({ root, declared, floors }) {
  const range = declared ?? readJson(path.join(root ?? "", "package.json"))?.engines?.node;
  if (typeof range !== "string" || !range.trim()) {
    return {
      ok: false,
      kind: "missing",
      reason: "package.json 没有 engines.node",
    };
  }
  if (!parseRange(range)) {
    return {
      ok: false,
      kind: "unparsable",
      range,
      reason: "engines.node 形状读不懂",
    };
  }

  /** @type {DependencyFloor[]} */
  let collected = floors ?? [];
  if (!floors) {
    const scanned = collectDependencyFloors(root ?? "");
    if (!scanned.ok) {
      return { ok: false, kind: "unparsable", range, reason: scanned.reason };
    }
    collected = scanned.floors;
  }

  /** @type {DependencyFloor[]} */
  const gaps = [];
  for (const f of collected) {
    const accepted = covers(f.range, range);
    if (accepted === null) {
      return {
        ok: false,
        kind: "unparsable",
        range,
        reason: `依赖 ${f.pkg} 的 engines.node 形状读不懂：${f.range}`,
      };
    }
    if (!accepted) {
      gaps.push(f);
    }
  }
  return {
    ok: gaps.length === 0,
    kind: gaps.length ? "gap" : "ok",
    range,
    gaps,
  };
}

/**
 * 当前 Node 落在声明范围的哪一边，并给一条**最近可达档**的建议。
 *
 * 「最近」而不是「最高」：Node 20.9 的人该听到 22.22.2，不是直接跳到 26 ——
 * 建议越贴近现状，越可能被真的执行。
 *
 * @param {{version: string | null | undefined, range: string | null | undefined, floors?: DependencyFloor[]}} input
 *   两个字段都来自外部（`package.json` 的 `engines`、运行时版本）—— 读不到就落 `unparsable`，
 *   那正是本函数要回答的三态之一。
 */
export function describeNodeAgainstFloor({ version, range, floors }) {
  const ok = satisfies(version, range);
  const parsed = parseVersion(String(version ?? "").replace(/^v/, ""));
  const clean = String(version ?? "").replace(/^v/, "");
  if (ok === null || !parsed) {
    return { ok: false, kind: "unparsable", version: clean, range };
  }
  return {
    ok,
    kind: ok ? "ok" : "outside",
    version: clean,
    range,
    /* 走到这里 `range` 已被 `satisfies` 判成读得懂（`ok !== null`），所以这一处的
     * `?? ""` 是类型收口 —— 与上面 `parseRange` 的可缺声明配套。 */
    recommend: ok ? null : recommendFrom(range ?? "", parsed),
    violated: (floors ?? []).filter((f) => satisfies(version, f.range) === false).map((f) => f.pkg),
  };
}

/**
 * @param {string} range
 * @param {Triple} currentVersion
 * @returns {string | null}
 */
function recommendFrom(range, currentVersion) {
  const intervals = parseRange(range);
  if (!intervals) {
    return null;
  }
  const above = intervals
    .map((iv) => iv.lower)
    .filter((lower) => compareVersions(lower, currentVersion) > 0)
    .sort((a, b) => compareVersions(a, b));
  /* 索引访问在 `noUncheckedIndexedAccess` 下是 `Triple | undefined`（`above` 可以为空），
   * 规则没建模那一层 —— 这处判空是真的。 */
  const first = /** @type {Triple | undefined} */ (above[0]);
  return first ? first.join(".") : null;
}

/**
 * @param {string} file
 * @returns {any}
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
