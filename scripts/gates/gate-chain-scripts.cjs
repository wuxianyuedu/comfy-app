#!/usr/bin/node
/**
 * gate-chain-scripts.cjs —— 「门禁链里被按名字调起的 `scripts/<x>`」的**单一定义点**。
 *
 * 两个消费方（ISSUE #2383 之前只有第一个）：
 *   · `check-gate-executors.cjs` —— 「这份脚本有没有执行者」的覆盖面；
 *   · `check-gate-thresholds.cjs` —— 「判据自身的数值要入账」的扫描根。
 * 两处各算一份必然漂（§12.12）：executors 那份扩了，thresholds 的扫描根不变，
 * 形态就是「这条判据有执行者、而它的数值没有任何东西在守」—— 正是 #2383 的立案现场。
 *
 * **只读「门禁步骤位置」，不读文件全文** —— 这一条是实测撞出来的：全文匹配会把
 * 注释里提到的、被本地 import 的、以及散文里当占位符举例的（`x.cjs` / `xxx.cjs`）
 * 一网打进，于是 `affected-tests.mjs`（清单库）、`install-git-hooks.mjs`（postinstall）、
 * `quality-gate.mjs`（编排器）、`quality-gate-shared.mjs`（共享常量）全被当成判据。
 * 下面三个位置才是「判据被当判据用」的事实：
 *   · `.githooks/pre-commit` 的 `run "<标签>" node scripts/<x>` 步骤行；
 *   · `scripts/gates/quality-gate.mjs` 的 `args: ["../scripts/<x>"]` gate 表项；
 *   · `scripts/gates/quality-gate.ps1` 的 `$Blocks` 表项（`Args` 栏）。
 * 比对 basename 而不是整条命令：三种写法（`scripts/x`、`../scripts/x`、
 * `scripts\x`）落点相同，而整条命令一比就会随引号 / 反斜杠 / 参数顺序漂移。
 *
 * ⚠️ 刻意**不读 `.cnb.yml`**：平台那一跑取自源分支、与本地钩子不是同一份清单
 * （AGENTS 硬规则 7），把它算进链会让「PR 档 / 每日档」的增删反过来改本地的覆盖面。
 * 只在平台档调起的 `ci-*.mjs` 因此不在链上 —— 那是口径，不是漏。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

/**
 * @returns {Set<string>} basename 集合（`shell-gate.mjs` 这一形状）
 */
function gateChainScripts() {
  const out = new Set();
  /**
   * 从一段文本里收 `scripts/<x>` 的 basename。
   * @param {string} text
   */
  const collect = (text) => {
    // 判据在 scripts/gates/（#3930）：命令里的路径可带域子目录，归一到 basename 再入集合。
    for (const m of text.matchAll(/scripts[\\/]+(?<script>[A-Za-z0-9_./-]+\.(?:cjs|mjs))/g)) {
      const base = (m.groups?.script ?? "").split(/[\\/]/).pop();
      if (base) out.add(base);
    }
  };

  // ① 钩子的 `run "<标签>" <命令>` 步骤行（与 tests/doc-check-hook-wiring.test.ts 同款解析）。
  const hook = path.join(ROOT, ".githooks/pre-commit");
  if (fs.existsSync(hook)) {
    for (const m of fs.readFileSync(hook, "utf8").matchAll(/^ {2}run "[^"]+" (?<command>.+)$/gm)) {
      collect(m.groups?.command ?? "");
    }
  }

  // ② `quality-gate.mjs` 的 gate 表项。
  const qm = path.join(ROOT, "scripts/gates/quality-gate.mjs");
  if (fs.existsSync(qm)) {
    for (const m of fs.readFileSync(qm, "utf8").matchAll(/args:\s*\[(?<args>[^\]]*)\]/g)) {
      collect(m.groups?.args ?? "");
    }
  }

  // ③ `quality-gate.ps1` 的 `$Blocks` 表项（`Cmd = "node"; Args = @("scripts\x.cjs")`）。
  const qp = path.join(ROOT, "scripts/gates/quality-gate.ps1");
  if (fs.existsSync(qp)) {
    for (const m of fs.readFileSync(qp, "utf8").matchAll(/Args\s*=\s*@\((?<args>[^)]*)\)/g)) {
      collect(m.groups?.args ?? "");
    }
  }

  return out;
}

/**
 * @returns {string[]} 链上脚本的**仓库相对路径**（`scripts/gates/shell-gate.mjs` 这一形状）。
 * 判据归入域子目录（#3930）之后，basename 拼回 `scripts/` 的平铺假设不再成立 ——
 * 消费方要拿真盘位置时走这里；只要 basename 的消费方仍用 `gateChainScripts()`。
 */
function gateChainPaths() {
  /** @type {Map<string, string[]>} */
  const candidates = new Map();
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (/\.(?:cjs|mjs)$/.test(e.name)) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        const prev = candidates.get(e.name) ?? [];
        candidates.set(e.name, [...prev, rel]);
      }
    }
  };
  walk(path.join(ROOT, "scripts"));
  /* 同名多份（#4111 过渡垫片落在平铺位、真身在域子目录）时取更深的那份 = 真身。 */
  const index = new Map(
    [...candidates].map(([name, rels]) => [
      name,
      rels.reduce((best, rel) => (rel.split("/").length > best.split("/").length ? rel : best)),
    ]),
  );
  return [...gateChainScripts()].map((name) => index.get(name) ?? `scripts/${name}`);
}

module.exports = { gateChainScripts, gateChainPaths };
