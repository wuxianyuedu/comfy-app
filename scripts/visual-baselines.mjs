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
 * 基线**新鲜度**账（`scripts/.visual-baseline-freshness.json`，规范 §11.8）。
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
 */
/** 新鲜度账文件（相对仓库根）。 */
export const FRESHNESS_LEDGER = "scripts/.visual-baseline-freshness.json";

/**
 * 新鲜度记录的形状（**读写共用这一份**：各写一套时记出来的会被自己的校验判成缺字段）。
 *
 * @param {{platform: string, verifiedAt: string, who: string, how: string}} input
 * @returns {{platform: string, verifiedAt: string, who: string, how: string}}
 */
export function freshnessRecord({ platform, verifiedAt, who, how }) {
  return {
    platform,
    verifiedAt: verifiedAt.trim(),
    who: who.trim(),
    how: how.trim(),
  };
}

/**
 * 校验新鲜度账（`{平台 → 记录}`）。空 = 放行。
 *
 * 三个方向都拦：缺档（还停在「录过就算数」）/ 记录写不全（没人能按它去复核）/
 * 挂在非登记档上（删平台不抹账，账就退化成一份没人认领的名单）。
 *
 * @param {Record<string, unknown>} ledger
 * @param {{required: string[], registered: string[]}} scope
 *   `required` = 必须有记录的档（登记档减去 pending）；`registered` = 全部登记档（孤儿检查）
 * @returns {string[]} 问题清单
 */
export function checkFreshnessLedger(ledger, { required, registered }) {
  /** @type {string[]} */
  const problems = [];
  for (const platform of required) {
    const entry = ledger[platform];
    if (entry === undefined || entry === null) {
      problems.push(
        `${platform} 档没有基线新鲜度记录 —— 这一档现在是「录过就算数」：` +
          "没有任何东西说清它上一次被实证跑绿是什么时候、按哪条命令。" +
          `在那一档跑一次 \`pnpm check:visual\`（绿即可记账，见 scripts/pixel-run.mjs），` +
          `或在 ${FRESHNESS_LEDGER} 里手工补一条。`,
      );
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${platform} 档的新鲜度记录不是对象 —— 形状见 freshnessRecord。`);
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
          `${platform} 档的新鲜度记录里 ${field} 没写清（"${value}"）—— ` +
            (field === "how"
              ? "这一栏要写**能照着重跑的那条命令**（写「稍后」「已复核」等于没写）。"
              : "这一栏是这条账存在的全部意义：谁、什么时候、按哪条命令复核的。"),
        );
      }
    }
    const at = String(rec.verifiedAt ?? "").trim();
    if (at && Number.isNaN(Date.parse(at))) {
      problems.push(
        `${platform} 档的 verifiedAt（"${at}"）不是一个能解析的日期 —— ` +
          "记账要能算「多久没跑」，写「最近」等于没写。",
      );
    }
  }
  for (const platform of Object.keys(ledger)) {
    if (!registered.includes(platform)) {
      problems.push(
        `新鲜度账里记着 ${platform} 档，但它不在登记口径里（${registered.join(" / ")}）—— ` +
          "删掉平台的档就要同批抹账，否则这张表会退化成一份没人认领的名单。",
      );
    }
  }
  return problems;
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
