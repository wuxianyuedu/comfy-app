#!/usr/bin/env node
/**
 * visual-baselines.mjs — 像素基线的**清点内核**（规范 §11.8 的单一事实源）
 *
 * 同一件事实——「每个截图名 × 每个登记平台都有一套被 git 跟踪的 PNG」——有两个消费方：
 *   · `tests/visual-baseline-pairing.test.ts`（每次提交都跑的判据）；
 *   · `scripts/pixel-run.mjs` 的**本机前置判决**（起 webServer / 浏览器之前先答
 *     「这台机器有没有基线」）。
 * 两个消费方各抄一份清点代码，就是 §12.12 的孪生对：判据说「基线成套」而像素档说
 * 「本机没有基线」时，两边都得能指出是哪一条、缺哪个文件，而两份实现必然漂。
 * 所以清点只写在这里，两侧 import，各自只留差异（判据还要做「反空转」自证，
 * 前置判决还要接 `process.platform`）。
 *
 * ⚠️ **文件名带平台，所以「本机没有基线」是一个必然会出现、且必须能被提前命名的状态**：
 * `toHaveScreenshot` 的默认文件名含 `-{platform}`，而 Playwright 的 `updateSnapshots`
 * 默认是 `'missing'` —— 缺基线时会**把生成的 PNG 写进 `*-snapshots/`**（既定事实见
 * `docs/standards/11-测试与可观测性.md` §11.8 与 `scripts/pixel-run.mjs` 的
 * `CHECK_UPDATE_MODE` 注释）。在没登记过的平台上跑，留下的是「半套基线」——
 * §11.8 判过：那比「没有那一档」更费人。
 *
 * 扫描面按 `e2e/visual/*.visual.spec.ts` 目录发现，**不维护 spec 清单** ——
 * 写死的清单正是会漂的那类东西。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** 像素层 spec 所在目录（与 `package.json` 的 `test:visual` 同一处落点）。 */
export const VISUAL_DIR = "e2e/visual";

/**
 * 项目实际会跑像素回归的平台（登记 = 有且仅有这几档在仓库里有一套 PNG）。
 *   · win32 —— 开发机，`pnpm dev` 口径（实测两次连跑零差异）。
 *   · linux —— 容器 / 类 CI 环境，`pnpm start` 口径（实测同一命令连跑两次零差异）。
 *
 * 这是**口径**，不是「有哪些平台存在」：新增一档执行环境时，先用同一份 spec 在那档
 * 上录出成套 PNG，再同批改这里（§11.8）。只登记不录 = 那一档一跑就红；只录不登记 =
 * 被孤儿判据点名。
 */
export const SUPPORTED_PLATFORMS = ["win32", "linux"];

/** `{name}-{projectName}-{platform}.png` —— Playwright 默认的基线文件形态。 */
export const BASENAME_RE = /^(.+)-chromium-(linux|win32|darwin)\.png$/;

/**
 * spec 里 `toHaveScreenshot("x.png")` 声明的截图名（不含扩展名）。
 *
 * @param {string} specText
 * @returns {string[]}
 */
export function declaredShotNames(specText) {
  const names = new Set();
  for (const m of specText.matchAll(/toHaveScreenshot\(\s*["']([^"']+)["']/g)) {
    const raw = m[1];
    if (raw) names.add(raw.replace(/\.png$/i, ""));
  }
  return [...names];
}

/**
 * 一份基线文件名拆出的「截图名 + 平台」；形状不对返回 null（由孤儿判据点名）。
 *
 * @param {string} file
 * @returns {{name: string, platform: string} | null}
 */
export function parseBaseline(file) {
  const m = BASENAME_RE.exec(file);
  const name = m?.[1];
  const platform = m?.[2];
  return name && platform ? { name, platform } : null;
}

/**
 * git 跟踪着的该目录下的文件（相对仓库根的路径）。
 *
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
export function trackedFiles(root, dir) {
  const out = execFileSync("git", ["ls-files", "--", dir], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split(/\r?\n/).filter(Boolean);
}

/**
 * 快照目录里的 PNG，按「截图名 → 平台数组」聚合。
 *
 * @param {string} root
 * @param {string} shotDir
 * @returns {Map<string, string[]>}
 */
export function snapshotsFor(root, shotDir) {
  const byName = new Map();
  const abs = path.join(root, shotDir);
  if (!existsSync(abs)) return byName;
  for (const file of readdirSync(abs)) {
    const parsed = parseBaseline(file);
    if (!parsed) continue;
    const list = byName.get(parsed.name) ?? [];
    list.push(parsed.platform);
    byName.set(parsed.name, list);
  }
  return byName;
}

/**
 * 扫描面：`e2e/visual/*.visual.spec.ts` 及其同名 `-snapshots` 目录。
 *
 * @param {string} root 仓库根
 * @returns {Array<{spec: string, shotDir: string, names: string[]}>}
 */
export function visualSpecs(root) {
  const dir = path.join(root, VISUAL_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".visual.spec.ts"))
    .map((f) => ({
      spec: `${VISUAL_DIR}/${f}`,
      shotDir: `${VISUAL_DIR}/${f}-snapshots`,
      names: declaredShotNames(
        readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n"),
      ),
    }));
}

/**
 * 某一档平台缺哪些基线 —— 「本机没有基线」的唯一判据形状。
 *
 * 返回**缺文件的相对路径清单**（而不是布尔）：点名到文件，人才知道要录哪几张；
 * 只回一句「本机没有基线」等于把「缺什么」留给下一个人去猜。
 *
 * @param {string} root
 * @param {string} platform `process.platform` 的形状（win32 / linux / darwin）
 * @returns {string[]} 形如 `e2e/visual/x.visual.spec.ts-snapshots/<name>-chromium-<platform>.png`
 */
export function missingBaselinesForPlatform(root, platform) {
  const missing = [];
  for (const { shotDir, names } of visualSpecs(root)) {
    const found = snapshotsFor(root, shotDir);
    for (const name of names) {
      if (!(found.get(name) ?? []).includes(platform)) {
        missing.push(`${shotDir}/${name}-chromium-${platform}.png`);
      }
    }
  }
  return missing;
}

/**
 * 本机平台是否在登记口径里 —— 不在 = 这一档从来没有基线，跑像素只会写半套。
 *
 * 与「本机缺哪张 PNG」分开两个问题：平台没登记时缺的是**整档**，动作是按 §11.8
 * 先录一套再登记平台；平台登记了而缺几张，动作是补齐那几张。
 *
 * @param {string} platform
 * @returns {boolean}
 */
export function isPlatformRegistered(platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

/**
 * 快照目录里「磁盘上有但 git 没跟踪」的 PNG —— 只在本机绿 / 半套基线的形态。
 *
 * @param {string} root
 * @returns {string[]}
 */
export function untrackedBaselines(root) {
  const untracked = [];
  for (const { shotDir } of visualSpecs(root)) {
    const abs = path.join(root, shotDir);
    if (!existsSync(abs)) continue;
    const tracked = new Set(trackedFiles(root, shotDir));
    for (const file of readdirSync(abs)) {
      if (!file.endsWith(".png")) continue;
      if (!tracked.has(`${shotDir}/${file}`)) untracked.push(`${shotDir}/${file}`);
    }
  }
  return untracked;
}
