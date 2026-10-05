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
 * 项目实际会跑像素回归的平台（登记 = 有且仅有这几档在仓库里有一套 PNG），
 * 以及那一档的基线**录于哪一条 webServer 口径**。
 *
 * 口径这一栏不是注释而是**数据**：`playwright.config.ts` 按 `process.env.CI` 的真假
 * 分流 webServer（假 ⇒ `pnpm dev`、真 ⇒ `pnpm start`），而两个口径下**像素不相同**
 * （Next 的 dev 指示器挂在 shadow root 里、宿主 bounding box 是 0×0，`mask` 遮不住它——
 * 见 §11.8 那条实测）。于是「在这档录基线时 `CI` 是真还是假」是**基线身份的一部分**：
 * 录错了口径，基线看着被成功创建，实际记的是另一种 chrome 之下的界面，而它**不会当场红**
 * ——只在以后某次真差异里混进来、指不出是它。写进数据是因为口径只写在文档里时，
 * 校验无从下手（`pixel-run.mjs` 的录基线档此前不校验它）。
 *
 *   · `dev`   —— `CI` **不设**时走的口径（`pnpm dev`）。
 *   · `start` —— `CI` 为真时走的口径（`pnpm start`，要求先有生产构建）。
 *
 * 这是**口径**，不是「有哪些平台存在」：新增一档执行环境时，先用同一份 spec 在那档
 * 上录出成套 PNG，再同批改这里（§11.8）。只登记不录 = 那一档一跑就红；只录不登记 =
 * 被孤儿判据点名。
 */
/** @type {Record<string, {webserver: "dev" | "start", note: string}>} */
export const PLATFORM_RECORDING = {
  win32: { webserver: "dev", note: "开发机，实测同一命令连跑两次零差异" },
  linux: { webserver: "start", note: "容器 / 类 CI，`CI` 为真，需先 `pnpm build`" },
};

/**
 * 登记过的平台名（`PLATFORM_RECORDING` 的键）。
 *
 * 从上面那张表**派生**，不另写一份数组：两处各写一份时，「登记了平台」与「知道它
 * 录于哪个口径」会漂成两件事，而 `isPlatformRegistered` 只认后者时就会漏。
 */
export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_RECORDING);

/**
 * 「这一档**登记在案、但当前缺基线**」的平台 → 它的账。
 *
 * 为什么需要这个状态：`SUPPORTED_PLATFORMS` 是一句「这几档在仓库里都有一套 PNG」的
 * 承诺，而新增截图名会让**某一档缺几张**—— 缺的那些只能在**那一档的机器上**录出来
 * （像素是平台渲染的产物，在 linux 上录一份改名叫 `-win32` 是造假，不做）。
 * 于是「本机录不全，但另一档仍然必须维护」是一个必然出现、且必须能被提前命名的状态。
 *
 * 不写这张表会退化成两种都更坏的形态：① 判据红着而没人知道红的是「待重录」还是
 * 「真丢了基线上库」；② 干脆把那一档从 `SUPPORTED_PLATFORMS` 删掉 —— 那就是
 * §11.8 说的「删掉一档」，恢复还得再走一遍「先录再登记」。
 *
 * **这张表是负债，不是赦免名单**（与 `scripts/.gate-executor-ledger.json` 同族，
 * 见 §13.5.12）：登记项一旦在某档补齐，**必须**同批删掉这一条（`missingBaselinesForPlatform`
 * 返回空而登记还在 ⇒ 判据红）。`reason` 要写清「谁、在哪台机器补」，别写「稍后处理」。
 */
export const PENDING_PLATFORMS = {
  win32: {
    reason:
      "本仓库的自动化执行环境（NPC 工作区 / CNB 容器）都是 linux，win32 档" +
      "只能在 Windows 开发机上录。在 Windows 开发机上（`CI` 置空以走 dev 口径，" +
      "`pixel-run.mjs` 会核这一条）跑 `pnpm check:visual:update` 并成套提交，然后" +
      "把本登记删掉（配对判据会在补齐后仍然留着登记时红）。",
  },
};

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
 * 该平台缺的基线里，**哪些是「已登记待录」**（`PENDING_PLATFORMS`）。
 *
 * 判据与前置判决共用它，好处是「待录」这件事只有一处口径：判据据此放行（但要求
 * 平台上仍有缺失 —— 补齐了还留着登记就红），前置判决据此给出「这档正在待重录」
 * 而不是「这档没登记过」的话术。
 *
 * @param {string} platform
 * @returns {boolean}
 */
export function isPlatformPending(platform) {
  return Object.hasOwn(PENDING_PLATFORMS, platform);
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

/**
 * 该平台登记的是哪一条 webServer 口径（`dev` / `start`）；未登记返回 null。
 *
 * @param {string} platform
 * @returns {"dev" | "start" | null}
 */
export function recordingWebserverFor(platform) {
  return PLATFORM_RECORDING[platform]?.webserver ?? null;
}
/* 注：`PLATFORM_RECORDING` 是 `Record<string, …>`，所以 `recordingWebserverFor`
 * 对任意平台名都不报类型错 —— 这是刻意的：未登记的平台要能在运行期返回 null
 * （`darwin` 那一档在用例里就是这么验的），而不是被类型拒之门外。 */

/**
 * 本机 `CI` 的真假换算出的实际 webServer 口径 —— 与 `playwright.config.ts` 的分流**同一条**。
 *
 * `CI` 的判据是**真假**（不是「有没有这个键」）：`playwright.config.ts` 写的是
 * `process.env.CI ? "pnpm start" : "pnpm dev"`，所以空串同样落在 `pnpm dev` 那侧。
 * 不在这里另立一套判法（那是 §12.12 的孪生对）。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {"dev" | "start"}
 */
export function webserverForEnv(env = process.env) {
  return env.CI ? "start" : "dev";
}

/**
 * 「在这一档录／跑基线，`CI` 该怎么置」—— 口径守卫的唯一判据形状（§11.8）。
 *
 * 与「本机缺哪张 PNG」是两件事，所以分开：缺基线是**数量**问题（补齐那几张），
 * 口径不符是**身份**问题（录出来的 PNG 记的是另一种 chrome）。两者混成一句
 * 「像素档不能跑」会让人用同一个动作去治——而口径不符时补齐只是把错的录得更多。
 *
 * ⚠️ 只在**该平台已登记**时有答案：没登记的平台没有「原口径」可比，它走的是
 * 「先整套录、再同批登记」那一档（`checkLocalBaselines` 的话术），此时由人按
 * 落地环境选口径并在登记表里写下。
 *
 * @param {{platform: string, env?: Record<string, string | undefined>}} args
 * @returns {string | null} 不符时的话术（含动作），相符或平台未登记返回 null
 */
export function checkRecordingEnv({ platform, env = process.env }) {
  const expected = recordingWebserverFor(platform);
  if (expected === null) return null;
  const actual = webserverForEnv(env);
  if (actual === expected) return null;
  const want = expected === "dev" ? "`CI` 置空（或不设）" : "`CI` 置为真（如 `CI=true`）";
  const got = actual === "dev" ? "当前 `CI` 未设" : "当前 `CI` 为真";
  const fix =
    expected === "dev"
      ? "CI= pnpm check:visual:update            # POSIX\n" +
        "        $env:CI=$null; pnpm check:visual:update  # PowerShell"
      : "CI=true pnpm check:visual:update";
  return (
    `本机 \`CI\` 与 ${platform} 档基线的录制口径不一致：该档录于 \`pnpm ${expected}\` 口径，` +
    `而 ${got} ⇒ 会走 \`pnpm ${actual}\`。\n` +
    "      两个口径的像素**不相同**（dev 指示器那块 mask 目前遮不住），按现行 CI 录出的\n" +
    `      PNG 会被当成 ${platform} 档基线入库 —— 而它**不会当场红**，只在以后某次真差异里\n` +
    `      混进来、还指不出是它。所以跑之前先把 ${want}：\n` +
    `        ${fix}\n` +
    "      登记表在 scripts/visual-baselines.mjs 的 PLATFORM_RECORDING。"
  );
}
