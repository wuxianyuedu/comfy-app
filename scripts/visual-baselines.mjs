#!/usr/bin/env node
/**
 * visual-baselines.mjs — 像素基线的**清点内核**（规范 §11.8 的单一事实源）
 *
 * 同一件事实——「每个截图名 × 每个登记平台都有一套被 git 跟踪的 PNG」——有三个消费方：
 *   · `tests/visual-baseline-pairing.test.ts`（每次提交都跑的判据）；
 *   · `scripts/pixel-run.mjs` 的**本机前置判决**（起 webServer / 浏览器之前先答
 *     「这台机器有没有基线」）；
 *   · `scripts/pixel-run.mjs` 的**自证记账**（跑绿之后把「哪一档、谁、什么时候复核过」
 *     写进 `scripts/.visual-baseline-freshness.json`，见下面「基线新鲜度」那段）。
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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  linux: {
    webserver: "start",
    note: "容器 / 类 CI，`CI` 为真，需先 `pnpm build`",
  },
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
      if (!tracked.has(`${shotDir}/${file}`))
        untracked.push(`${shotDir}/${file}`);
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
  const want =
    expected === "dev" ? "`CI` 置空（或不设）" : "`CI` 置为真（如 `CI=true`）";
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

/**
 * **新鲜度账**（规范 §11.8）：`scripts/.visual-baseline-freshness.json` 记像素档、
 * `scripts/.e2e-freshness.json` 记全量 e2e —— **同形而不同键**。
 *
 * 为什么需要它：`PLATFORM_RECORDING` 只是一句「这几档在仓库里有一套 PNG」的承诺，
 * 而「那一套 PNG **现在还跑得绿**」是**另一件事** —— 本轮实测的现场是入库的
 * `-linux.png` 有 4 张与当前环境差 1 像素（文字整体下移一行），而三个既有判据
 * （`--update-snapshots` 总是绿 / 配对判据只核「成套且入库」/ `--update` 档不拦缺基线）
 * 一个都看不见它。**「录过一次」与「一直绿」是两件事**，而当时 linux 档的状态是
 * 「录过就算数」：没有一条账说清谁在什么时候复核过、下一次该由谁再跑一遍。
 *
 * 与 `PENDING_PLATFORMS` 的分工（两者都是「有主的欠条」，但欠的东西不同）：
 *   · `PENDING_PLATFORMS` 记的是**数量**欠账 —— 某一档缺哪几张 PNG（补录的账）；
 *   · 本表记的是**时效**欠账 —— 某一档的成套基线**上次被实证跑绿是什么时候**。
 * 一档可以「一张不缺、但三个月没人碰过」—— 那正是本条要治的形态，
 * 而 `PENDING_PLATFORMS` 对它一个字都说不出。
 *
 * ⚠️ **「过期」这条判据刻意不做墙钟阻断**：像素回归的结论只在**录过基线的那台机器上**
 * 成立（基线名带平台），而本仓库的自动化执行环境都是 linux —— win32 档的复核只能在
 * Windows 开发机上做。拿墙钟去阻断等于让所有人卡在一个**只有少数人能解**的账上，
 * 那正是 §11.8 里 `PENDING_PLATFORMS`「只提醒、不阻断」已经判过的那味药。
 * 所以纪律收在**可观测的形状**上，而不是收在时钟上：
 *   ① 每一档**都必须有一条**记录（没有 = 这一档还停在「录过就算数」）；
 *   ② 记录必须写得清「谁 / 什么时候 / 按哪条命令复核的」（空着或写「稍后」都算没写）；
 *   ③ 记录**不许**挂在不存在的档上（删了平台的档，账要同批抹掉，与 `PENDING_PLATFORMS`
 *      的双向不变式同族）。
 * 「多久没跑算旧」由**人**按上面的读数决定 —— 判据把它算出来、摆在每次跑像素的输出里，
 * 但不下一个会随机器与运气变化的阈值。
 *
 * 谁写它：`scripts/pixel-run.mjs` 在**当次检出自证跑绿**之后（`--update` 那一档除外 ——
 * 录基线本身不是自证）把这一档的记录刷新一次。也就是说**跑一次就记一次账**，
 * 「定期跑」这件事因此有了落点：账上的日期就是「上次真跑过」的事实。
 *
 * ⚠️ **键是「哪一档」而不是「哪个平台」**（ISSUE #1547）：同一个形状后来被**全量 e2e**
 * 那一档复用（`scripts/e2e-run.mjs`，账文件 `scripts/.e2e-freshness.json`）——
 * 两处的「一档」都恰好只有一个值（`linux` / `e2e`），但那是**数据**、不是形状的一部分。
 * 分辨它们的是 `trackedBy` 那一栏：它写清这条记录是**哪一个跑法**证出来的，
 * 于是把两条账抄混（e2e 的绿被记成像素档的自证）当场能被看见，而不是悄悄成立。
 */
/**
 * 一档新鲜度账的**登记处**：账文件 + 那一档的键 + 可读的名字。
 *
 * `runs` 是**数据**而不是 `if (kind === "visual")` 的分支：两条账的唯一区别就是这四个值
 * （账文件 / 键 / 名字 / 「怎么跑」那条命令），把差异写成分支就得到一份带两个开关的实现，
 * 而开关会随「第三档」的加入变成三向分支 —— 那正是 §12.12 要拦的孪生对。
 *
 * `daily` / `skipHow` 是两条账**真正的**差异所在，其余四栏两条同形：
 *   · `daily` —— 这一档是否按「每天首次提交带一次凭证」判（只有全量 e2e 是）。像素档
 *     不做墙钟阻断的理由见 `visual-freshness-gate.mjs` 文件头：它的结论只在录过基线的
 *     那台机器上成立，拿日历日去卡等于让所有人卡在一条只有少数人能解的账上。
 *   · `skipHow` —— 记一条「写明理由的豁免」那条命令（同样只有 e2e 有）。它是**另一条
 *     出路**而不是绕过：留下的是一条能复核的事实。
 *
 * @type {Record<string, {ledger: string, key: string, label: string, run: string, daily: boolean, skipHow: string | null, dirty: string[], dirtyHow: string | null, graceMs: number}>}
 */
export const FRESHNESS_TRACKS = {
  visual: {
    ledger: "scripts/.visual-baseline-freshness.json",
    key: "linux",
    label: "linux 档像素基线",
    run: "pnpm check:visual",
    daily: false,
    skipHow: null,
    dirty: [],
    dirtyHow: null,
    graceMs: 0,
  },
  e2e: {
    ledger: "scripts/.e2e-freshness.json",
    key: "e2e",
    label: "全量 e2e",
    run: "pnpm test:e2e",
    daily: true,
    skipHow: 'node scripts/e2e-run.mjs --skip "<理由>"',
    /* 这一档**不吃输入面**（`dirty` 为空）：它的结论与改了哪几个文件无关 ——
     * 同一份 spec 在任何改动上都该绿。所以它没有「这次改动不吃这一档」那条出路
     * （`dirtyHow` 即 null），也不需要宽限（按日历日判）。 */
    dirty: [],
    dirtyHow: null,
    graceMs: 0,
  },
  full: {
    ledger: "scripts/.full-suite-freshness.json",
    key: "full",
    label: "全量单测 + 覆盖率门槛",
    run: "pnpm run test:coverage",
    daily: true,
    skipHow: 'node scripts/full-suite-run.mjs --skip "<理由>"',
    dirty: ["src/", "tests/"],
    dirtyHow: 'node scripts/full-suite-run.mjs --dirty "<理由>"',
    graceMs: 7 * 86_400_000,
  },
  artifact: {
    ledger: "scripts/.artifact-freshness.json",
    key: "artifact",
    label: "产物级护栏（build + 数产物）",
    run: "pnpm run build",
    daily: true,
    skipHow: 'node scripts/artifact-run.mjs --skip "<理由>"',
    dirty: [
      "next.config.js",
      "src-tauri/",
      "scripts/build-desktop.mjs",
      "scripts/standalone-private-inputs.mjs",
      "scripts/standalone-runtime.mjs",
      "scripts/build-executor-host.mjs",
    ],
    dirtyHow: 'node scripts/artifact-run.mjs --dirty "<理由>"',
    graceMs: 7 * 86_400_000,
  },
};

/** 迁移期的兼容出口：像素档那一份账的路径（= `FRESHNESS_TRACKS.visual.ledger`）。 */
export const FRESHNESS_LEDGER = freshnessTrack("visual").ledger;

/**
 * 取一档的登记（未知的 kind 是**编码错误**，抛而不是回落 —— 回落会让「新加一档却忘了
 * 登记」表现成「按键名当档名」而照样跑绿）。
 *
 * @param {keyof typeof FRESHNESS_TRACKS | string} kind
 * @returns {{ledger: string, key: string, label: string, run: string}}
 */
export function freshnessTrack(kind) {
  const track = FRESHNESS_TRACKS[kind];
  if (!track) {
    throw new Error(
      `[visual-baselines] 未登记的新鲜度档：${kind}（可选：${Object.keys(FRESHNESS_TRACKS).join(" / ")}）`,
    );
  }
  return track;
}

/**
 * 新鲜度记录的形状（**读写共用这一份**：各写一套时记出来的会被自己的校验判成缺字段）。
 *
 * 四栏各管一件事，缺一栏这条账就退化：
 *   · `key` —— 是**哪一档**（像素按平台分档，故这一栏在那边是 `linux`；全量 e2e 那边是
 *     `e2e`）。写成通用名而不是 `platform`，是因为第二条账的「档」不是平台。
 *   · `verifiedAt` / `who` —— 「上一次被实证跑绿是什么时候、谁跑的」。
 *   · `how` —— **能照着重跑的那条命令**（这就是你要写 `pnpm test:e2e` 而不是「跑过了」的原因）。
 *   · `trackedBy` —— 这条记录属于**哪一个跑法**（`FRESHNESS_TRACKS` 的键）。它是两条账
 *     唯一的形状差异，作用是把「e2e 的绿被记进像素档的账」这类抄混当场照出来。
 *
 * @param {{key: string, verifiedAt: string, who: string, how: string, trackedBy: string, skippedReason?: string, dirtyReason?: string}} input
 * @returns {{key: string, verifiedAt: string, who: string, how: string, trackedBy: string, skippedReason?: string, dirtyReason?: string}}
 */
export function freshnessRecord({
  key,
  verifiedAt,
  who,
  how,
  trackedBy,
  skippedReason,
  dirtyReason,
}) {
  /** @type {Record<string, string>} */
  const record = {
    key: key.trim(),
    verifiedAt: verifiedAt.trim(),
    who: who.trim(),
    how: how.trim(),
    trackedBy: trackedBy.trim(),
  };
  /* 两栏「不跑」的理由都在这里透传 —— **两栏都得列**：只透传 `skippedReason` 时，
   * `--dirty` 写下的那句会**在这一步被静默丢掉**（`freshnessRecord` 只搬它认识的键），
   * 于是账面上剩一条没有任何理由的记录、而 `verifiedAt` 是今天 ⇒ 判据当它「今天自证过」
   * 放行。那正是本条最不能有的形态：一个看着正常的记录指的是另一件事。
   *
   * 两栏各管一件事：`skippedReason` = 今天故意不跑；`dirtyReason` = 这次改动不吃这一档。
   * 两者都要能复核（同一份 `isUsableSkipReason` 核对），区别只在**读起来不一样**
   * —— 混成一栏之后，「这一档三个月没跑」与「这三个月每次都声明不吃它」长得一模一样。 */
  for (const [field, value] of [
    ["skippedReason", skippedReason],
    ["dirtyReason", dirtyReason],
  ]) {
    if (typeof value === "string" && value.trim()) record[field] = value.trim();
  }
  return record;
}

/**
 * 豁免理由的下限 —— 「有人回答过」与「没回答」要长得不一样。
 *
 * 占位词（「稍后」「待定」「TBD」…）与过短的理由都判不可用：豁免不是绕过，它留下的
 * 是一条**能被复核的事实**，而「稍后」什么都没留下。
 *
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isUsableSkipReason(reason) {
  const text = String(reason ?? "").trim();
  if (text.length < 8) return false;
  return !/^(稍后|待定|下次|回头|todo|tbd|na|n\/a)$/i.test(text);
}

/**
 * 「同一个**日历日**」的判据 —— 「每天首次提交」按本地时区日界判，不按 24 小时窗口。
 *
 * 人的记忆与工作节奏都是按日历日走的（「今天提交过了吗」），而滚动窗口会把昨天 23:00
 * 与今天 08:00 算成连续两次，于是今天早晨的第一次被静默跳过。
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
export function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 「这一档的输入面**今天**被改过」的判据 —— 三档「每天首次」里代价高的那两档读它。
 *
 * 为什么要有它（而不是一律按日历日判）：全量 e2e 人人都跑得动、结论与改了哪几个文件
 * 无关，所以「当天第一次提交带一次凭证」是句正当的话；而全量单测 + 覆盖率（10 分钟量级）
 * 与产物级护栏（`next build` + 数产物）**没必要每天都跑** —— 没碰 `src/` 的一天跑一遍，
 * 换来的是十分钟墙钟与一个不会变的结论。那两档真正想要的是「**改了就当天跑**」。
 *
 * 口径：`track.dirty` 是**路径前缀**（不是 glob）—— 前缀足够表达「这一档吃哪个目录」，
 * 而 glob 会把「为什么这条没命中」变成一处要现场调试的正则。空数组 = 这一档不改输入面
 * （= 每天都得自证），与 `dirty` 缺省同义。
 *
 * `at` 是**账上那次自证的时刻**：它比 `now` 早或同在 `dirtySince` 之后，就算这一档
 * 已经被今天的改动自证过了。比 `now` 早是常态（改动与自证之间隔着几小时）。
 *
 * @param {{dirty?: string[]}} track
 * @param {string[]} changed 当天改动过的文件（相对仓库根、POSIX 分隔符）
 * @returns {boolean}
 */
export function dirtiesTrack(track, changed) {
  const prefixes = track.dirty ?? [];
  if (prefixes.length === 0) return false;
  return changed.some((rel) => prefixes.some((p) => rel.startsWith(p)));
}

/**
 * 「每天首次」那一档的判决话术（三档共用一份，差异由 `track` 的数据决定）。
 *
 * 抽成纯函数是为了让**每一档的每一条边界**都能被真跑一次：`checkFreshnessLedger`
 * 里那段内联实现此前只服务一档，参数化之后若还写在里面，「dirty 档在没动输入面的那天
 * 放行」这条边界就永远不会被任何东西走到（那是 §11.18.3.1 那族的静默漏报）。
 *
 * 三种形态，每一种对应一句**可执行**的话：
 *   · 今天已有自证（`at` 不早于今天日界，或晚于 `dirtySince`）⇒ 放行；
 *   · 今天动过输入面而账还停在改动之前 ⇒ 拦，动作是「现在跑一次」；
 *   · 没动输入面但已经旧过 `graceMs` ⇒ 拦，动作是「跑一次，或记一条 `--dirty` 说明」。
 *
 * @param {{track: {label: string, run: string, skipHow: string | null, dirty: string[], dirtyHow: string | null, graceMs: number}, at: Date, now: Date, dirtySince: Date | null}} input
 * @returns {string | null} 拦下时给一句问题；放行时 null
 */
export function freshnessVerdict({ track, at, now, dirtySince }) {
  /* `dirtySince` 只对**吃输入面**的那几档有意义（`track.dirty` 非空）。不吃的那一档
   * （全量 e2e）收到一个非 null 的 `dirtySince` 时**必须忽略它** —— 否则「今天动过一次
   * 任何文件」会被读成「这一档已经被自证了」，于是「每天首次」那条判据在有人动过代码的
   * 日子里**整个失效**（而账面上看不出任何异常）。 */
  const since = (track.dirty ?? []).length > 0 ? dirtySince : null;
  const dirtyHows = [
    `跑一次 \`${track.run}\`（跑绿即记）`,
    track.skipHow ? `记一条写明理由的豁免：\`${track.skipHow}\`` : null,
  ].filter(Boolean);
  const how = `\n        记账：${dirtyHows.join("，或")}。`;
  /* 今天已经自证过：日界比一次（`at` 落在今天），或这次自证的时刻晚于当天的第一次
   * 改动 —— 后者是「先改后跑」与「先跑后改」两种顺序都要放行的那一条边界。 */
  if (isSameLocalDay(at, now)) return null;
  if (since && at.getTime() >= since.getTime()) return null;
  if ((track.dirty ?? []).length === 0) {
    return (
      `今天还没有自证 —— 上一次跑绿在 "${at.toISOString()}"，不是今天。` + how
    );
  }
  if (since) {
    return (
      `今天的提交动过这一档的输入面（${track.dirty.join(" / ")}），而它还没有自证 —— ` +
      `上一次跑绿在 "${at.toISOString()}"，早于当天的第一次改动。` +
      how +
      (track.dirtyHow
        ? `\n              若这次改动确实不吃这一档：\`${track.dirtyHow}\`。`
        : "")
    );
  }
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (track.graceMs > 0 && now.getTime() - at.getTime() <= track.graceMs) {
    return null;
  }
  return (
    `已经 ${days} 天没有自证（上一次跑绿在 "${at.toISOString()}"），` +
    `超过了 ${Math.round(track.graceMs / 86_400_000)} 天的宽限。` +
    how +
    (track.dirtyHow
      ? `\n              若近期改动确实不吃这一档：\`${track.dirtyHow}\`。`
      : "")
  );
}

/**
 * 校验一份新鲜度账（`{档 → 记录}`）。空 = 放行。
 *
 * 四个方向都拦：缺档（还停在「录过就算数」）/ 记录写不全（没人能按它去复核）/
 * 挂在非登记档上（删平台不抹账，账就退化成一份没人认领的名单）/
 * **记录被写错了跑法**（`trackedBy` 与这份账不是同一个 —— 两条账抄混时，
 * 「跑过一次」与「跑过的是哪一个」会变成两件事，而账面上看着完全正常）。
 *
 * @param {Record<string, unknown>} ledger
 * @param {{required: string[], registered: string[], track: {ledger: string, label: string, run: string}, kind: string}} scope
 *   `required` = 必须有记录的档（登记档减去 pending）；`registered` = 全部登记档（孤儿检查）；
 *   `track` = 这一份账的登记（话术里要给出「去哪个文件补、按哪条命令跑」）；
 *   `kind` = 这一份账属于哪个跑法（`trackedBy` 的比对基准）；
 *   `now` = 判「今天有没有自证」用的时钟（`track.daily` 那一档才读它；用例可注入）；
 *   `dirtySince` = **今天动过这一档输入面**的那个提交时刻（没有则 null）。只有
 *     `track.dirty` 非空的档读它 —— 那两档按「改了就当天跑」判，而不是「每天一次仪式」。
 * @returns {string[]} 问题清单
 */
export function checkFreshnessLedger(
  ledger,
  { required, registered, track, kind, now = new Date(), dirtySince = null },
) {
  /** @type {string[]} */
  const problems = [];
  for (const key of required) {
    const entry = ledger[key];
    if (entry === undefined || entry === null) {
      problems.push(
        `${track.label}（${key}）没有新鲜度记录 —— 这一档现在是「录过一次就算数」：` +
          "没有任何东西说清它上一次被实证跑绿是什么时候、按哪条命令。" +
          `跑一次 \`${track.run}\`（绿即可记账，见 scripts 下对应的跑法脚本），` +
          `或在 ${track.ledger} 里手工补一条。`,
      );
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(
        `${track.label}（${key}）的新鲜度记录不是对象 —— 形状见 freshnessRecord。`,
      );
      continue;
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    /* 每一栏的下限只挡「空着 / 明显是占位」的形状，不拿字数去判「写得好不好」：
     * `who` 是个人名（"月读" 两个字完全够用），拿统一的字数门槛会把合法值判红 ——
     * 而一个会误杀合法输入的判据，下场是被人整条绕开。`how` 要的是**能照着重跑**的命令，
     * 所以它另有一档下限（一条真命令不会短于几字符）。 */
    /** @type {Array<[string, number]>} */
    const minChars = [
      ["verifiedAt", 4],
      ["who", 2],
      ["how", 6],
    ];
    for (const [field, min] of minChars) {
      const value = String(rec[field] ?? "").trim();
      if (value.length < min) {
        problems.push(
          `${track.label}（${key}）的新鲜度记录里 ${field} 没写清（"${value}"）—— ` +
            (field === "how"
              ? "这一栏要写**能照着重跑的那条命令**（写「稍后」「已复核」等于没写）。"
              : "这一栏是这条账存在的全部意义：谁、什么时候、按哪条命令复核的。"),
        );
      }
    }
    const at = String(rec.verifiedAt ?? "").trim();
    if (at && Number.isNaN(Date.parse(at))) {
      problems.push(
        `${track.label}（${key}）的 verifiedAt（"${at}"）不是一个能解析的日期 —— ` +
          "记账要能算「多久没跑」，写「最近」等于没写。",
      );
    }
    /* 跑法必须对得上：两条账同形，抄混一次就会让「这一档被证过绿」变成一句
     * 不成立的话，而账面上看不出任何异常（都是合法的日期 + 人名 + 命令）。 */
    const by = String(rec.trackedBy ?? "").trim();
    if (by !== kind) {
      problems.push(
        `${track.label}（${key}）的记录写着它由「${by || "(空)"}」跑法证出来，` +
          `而这份账属于「${kind}」—— 两条新鲜度账同形，抄混之后账面上完全正常，` +
          "只有这一栏能把它们分开。",
      );
    }
    /* 「每天首次」那一档多一条判据：这一次自证必须是**今天**的（或一条写明理由的豁免）。
     * 它只判日历日，不判「多久算旧」—— 阈值仍然不写进判据（像素档那句同样的取舍）。
     * 记录写不清时上面已经拦过，这里只在形状成立时才比日期，免得同一件事报两遍。
     *
     * 三档「每天首次」**不等价**，差异全在 `track.dirty` 上（数据，不是分支）：
     *   · `dirty` 为空（全量 e2e）—— 这一档的代价最低（人人都跑得动），而且它的结论
     *     与「改了哪几个文件」没有关系（同一份 spec 在任何改动上都该绿）。所以直接按
     *     日历日判：当天第一次提交必须带一次凭证。
     *   · `dirty` 非空（全量单测 + 覆盖率 / 产物级护栏）—— 这两档**没必要每天都跑**：
     *     没碰 `src/` 的一天跑一遍全量单测，换来的是 10 分钟墙钟与一个不会变的结论。
     *     所以它按「**当天有没有提交动过这一档的输入面**」判（`dirtyCoveredOnDay`）：
     *     动过才要今天自证；没动过则以 `graceMs` 为宽限 —— 超过宽限、或当天动过而没自证
     *     ⇒ 两头都拦。这条把「每日执行」从「每天一次仪式」改成了「**改了就当天跑**」，
     *     而后者才是这三档真正想要的。 */
    if (track.daily) {
      /* 「不跑」有两种，形状各自成立、**互不等于**：`skippedReason`（今天故意不跑）与
       * `dirtyReason`（这次改动不吃这一档）。两者都放行，但都要能复核 —— 混成一栏之后，
       * 账面上就分不出「这一档一直没人跑」与「每次都声明不吃它」。 */
      const waiver = ["skippedReason", "dirtyReason"].find(
        (f) => typeof rec[f] === "string" && rec[f].trim(),
      );
      if (waiver) {
        if (!isUsableSkipReason(rec[waiver])) {
          problems.push(
            `${track.label}（${key}）的${waiver === "dirtyReason" ? "「不吃这一档」" : "豁免"}理由` +
              `（"${String(rec[waiver]).trim()}"）不算「有人回答过」—— ` +
              `留下的是一条能被复核的事实，占位词与过短的理由什么都没留下。` +
              `写清这次为什么不跑，或直接跑一次 \`${track.run}\`。`,
          );
        }
      } else {
        const ms = Date.parse(String(rec.verifiedAt ?? ""));
        if (!Number.isNaN(ms)) {
          const at = new Date(ms);
          const stale = freshnessVerdict({ track, at, now, dirtySince });
          if (stale) problems.push(`${track.label}（${key}）${stale}`);
        }
      }
    }
  }
  for (const key of Object.keys(ledger)) {
    if (!registered.includes(key)) {
      problems.push(
        `新鲜度账里记着 ${key}，但它不在这一份账的登记口径里（${registered.join(" / ")}）—— ` +
          "删掉某一档就要同批抹账，否则这张表会退化成一份没人认领的名单。",
      );
    }
  }
  return problems;
}

/**
 * 读一份新鲜度账；读不出（不存在 / 坏 JSON / 不是对象）返回 `{}`。
 *
 * 抽在这里而不是每个跑法脚本各写一份：两条账要**同一套**「读不出就等于一档都没记」
 * 的语义 —— 各写一份时，一边把坏 JSON 当成空账（判红、话术正确），另一边把它当成
 * 「解析失败但先放行」，而后者不报错、只是静默少守一条。
 *
 * @param {string} root 仓库根
 * @param {string} rel 账文件相对路径（`FRESHNESS_TRACKS[*].ledger`）
 * @returns {Record<string, unknown>}
 */
export function readFreshnessLedgerAt(root, rel) {
  try {
    const parsed = /** @type {unknown} */ (
      JSON.parse(readFileSync(path.join(root, rel), "utf8"))
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return {};
  }
}

/**
 * 把一档的**跑绿**写进它那份账（返回给输出用的一句读数）。
 *
 * 三条边界（与 `pixel-run.mjs` 原本内联的那段逐字一致，只是搬到这里由两条账共用）：
 *   · **只有「检查档」记**：录基线 / 录快照本身**不是**自证。
 *   · **只有绿了才记**：红着的时候记一条「我跑过」会把「跑过」与「跑绿过」混成一件
 *     事，而那正是这条账要防的。
 *   · **写账失败不算跑法失败**：像素 / e2e 的结论已经拿到了，返非零会把两件事混成一句
 *     「跑法挂了」。所以只提示、由调用方决定。
 *
 * 返回 `{ note, previous }`：`note` 是给人读的一句（写盘失败时也带着失败原因），
 * `previous` 是**写之前**那一档上次自证距今多久（账的价值在于被看见，不是被写下来）。
 *
 * @param {{root: string, kind: string, who: string}} args
 * @returns {{note: string, previous: string | null}}
 */
export function writeFreshness({ root, kind, who }) {
  const track = freshnessTrack(kind);
  const file = path.join(root, track.ledger);
  const ledger = readFreshnessLedgerAt(root, track.ledger);
  const previous = freshnessAge(ledger[track.key]);
  ledger[track.key] = freshnessRecord({
    key: track.key,
    verifiedAt: new Date().toISOString(),
    who,
    how: track.run,
    trackedBy: kind,
  });
  try {
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  } catch (err) {
    return {
      previous,
      note:
        `（记账失败：${err instanceof Error ? err.message : String(err)} —— ` +
        `${track.label}的结论仍然有效，手工补 ${track.ledger}）`,
    };
  }
  return {
    previous,
    note:
      `${track.label}已记账（上次自证：${previous ?? "无记录"}）—— ` +
      `改 ${track.ledger} 时请连同提交，它是「这一档上次跑绿在什么时候」的唯一事实。`,
  };
}

/**
 * 把一档的**豁免**写进它那份账 —— 「今天不跑，但理由有人回答过」。
 *
 * 与 `writeFreshness` 的唯一区别是记的形状：那一份带的是「跑绿的日期」，这一份带的是
 * `skippedReason`。两者都能让「每天首次」那条判据放行，但**读起来不一样** ——
 * 账面上因此看得出「今天跑过」和「今天说好不跑」不是同一件事（豁免不是绕过）。
 *
 * 理由不合用（过短 / 占位）时**抛**，由调用方转成退出码：与其记一条没有信息的账
 * 让人以为「已经处理过」，不如当场把这条命令退回去。
 *
 * @param {{root: string, kind: string, who: string, reason: unknown, field?: "skippedReason" | "dirtyReason"}} args
 *   `field` 缺省是「豁免」（`skippedReason`）；`dirtyReason` 是「这次改动不吃这一档」。
 * @returns {{note: string, previous: string | null}}
 */
export function writeSkipRecord({ root, kind, who, reason, field }) {
  const track = freshnessTrack(kind);
  /* `field` 区分**两种**「不跑」：`skippedReason`（今天故意不跑，理由要能复核）与
   * `dirtyReason`（这次改动确实不吃这一档）。两者都让判据放行，但账面上必须看得出
   * 它们不是同一件事 —— 混成一栏之后，「这一档三个月没跑」与「这三个月每次都说不吃它」
   * 会长得一模一样，而那正是这张账要防的形态。 */
  const written = field ?? "skippedReason";
  if (written === "skippedReason" && !track.skipHow) {
    throw new Error(`[visual-baselines] ${kind} 档没有「豁免」这条出路`);
  }
  if (!isUsableSkipReason(reason)) {
    throw new Error(
      `[visual-baselines] 理由（"${String(reason ?? "").trim()}"）不算「有人回答过」—— ` +
        "写清这次为什么不跑（占位词与过短的理由都被拦）。",
    );
  }
  const file = path.join(root, track.ledger);
  const ledger = readFreshnessLedgerAt(root, track.ledger);
  const previous = freshnessAge(ledger[track.key]);
  ledger[track.key] = freshnessRecord({
    key: track.key,
    verifiedAt: new Date().toISOString(),
    who,
    how: track.run,
    trackedBy: kind,
    [written]: String(reason).trim(),
  });
  try {
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  } catch (err) {
    return {
      previous,
      note:
        `（记账失败：${err instanceof Error ? err.message : String(err)} —— ` +
        `手工补 ${track.ledger}）`,
    };
  }
  return {
    previous,
    note:
      `${track.label}已记一条${written === "skippedReason" ? "豁免" : "「不吃这一档」"}（上次自证：` +
      `${previous ?? "无记录"}）—— 理由写在 ${track.ledger} 的 ${written} 里，改它时请连同提交。`,
  };
}

/**
 * 「这一档上次被跑绿距今多久」—— 给输出用的一句读数（**不是判据**）。
 *
 * 只在记录写得全、日期解得开时给；否则返回 null（缺日期时算一个天数毫无意义，
 * 而把 null 当 0 天读会把「没记」显示成「刚刚跑过」）。
 *
 * @param {unknown} entry
 * @param {Date} [now] 便于用例喂固定时钟
 * @returns {string | null}
 */
export function freshnessAge(entry, now = new Date()) {
  if (entry === null || typeof entry !== "object") return null;
  const at = String(
    /** @type {Record<string, unknown>} */ (entry).verifiedAt ?? "",
  ).trim();
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const days = Math.floor((now.getTime() - ms) / 86_400_000);
  if (days < 0) return null;
  return days === 0 ? "今天" : `${days} 天前`;
}
