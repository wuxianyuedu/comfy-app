#!/usr/bin/env node
/**
 * `eslint` 的**文件级豁免台账** ⇄ 真违例 的对账 —— 规范见 docs/standards/13-提交与-code-review.md
 * §13.5.14（脚本档那一族）与 ISSUE #2607 第 3 条。
 *
 * ── 它补的是哪一格 ────────────────────────────────────────────────
 *
 * `oxlint.parity.config.mjs` 里有一批「某条 core 规则对**指定文件**关掉」的台账，形状是
 * `{ files: ["a.cjs", "b.ts"], rules: { "<规则>": "off" } }`。那种台账自己的注释写着
 * **何时可移除**（`no-control-regex` 那一块的原话是「若某文件改用非正则方案处理控制字符，
 * 可把该文件从这里摘掉」）—— 而这句话此前**没有任何执行者**：谁把那份文件改干净了，
 * 台账里那一行照样躺在配置上，一个字都不会红。这就是本仓反复记的那一型
 * （**判据在场、执行者不在场**，§13.5.8 / §11.23）。
 *
 * 现场读数（本机，ISSUE #2607 那一条评论里也有）：`no-control-regex` 的台账 13 条，
 * 用规则本体逐份复算 = 13 份真违例 / 19 处命中 —— 今天**零漂移**。所以这条判据上线时
 * **不需要基线文件**（存量已经清着），可以直接做成会红的那一档。
 *
 * ── 只判一个方向（另一半早有人在执行）──────────────────────────────
 *
 *   · **漏登记**（文件里有命中、台账没它）⇒ 这就是 `pnpm run lint` 本体会报的那条错
 *     （`ESLint 零警告` 那一格，`--max-warnings 0`）。**本脚本不重复实现它** ——
 *     同一个判决立第二个执行者，就是给下一次「两套口径不一致」备料（AGENTS 硬规则 28 ③）。
 *   · **多登记 / 陈旧豁免**（台账里有它、现在**没有**命中了）⇒ 此前没有任何东西在读，
 *     本脚本判的就是这一向。
 *
 * ── 判决主体切到 oxlint 之后（#2777 PR-B）────────────────────────
 *
 * 台账的**出处**已换成 oxlint 判决配置（`loadOxlintConfig()`），不再读
 * `eslint.config.js`（#3157 起它已删除，判决面只剩 oxlint）。
 *
 * ── 取数口径：oxlint CLI（#2777 PR-C）─────────────────────────────
 *
 * 取数改调 `node_modules/oxlint/bin/oxlint --format json`，**不再吃 eslint 运行期 API**
 * （原来的同进程 `Linter` 是 eslint 依赖的最后一处硬耦合）。判决配置对这批文件把
 * 目标规则关着（那正是被对账的台账），所以要量「现在还违不违例」，得另起一份**最小
 * 临时配置**把它打开；那份件落在 `os.tmpdir()`（仓外，不进脚本档判决面），跑完
 * `finally` 里删掉。规则名归一后与台账逐条比（oxlint 的 JSON 里 core 规则写作
 * `eslint(no-control-regex)`）。
 *
 * ⚠️ **本脚本最要紧的一条设计来自一次真实的假绿**：取数**每一份都没被判成**时，
 * 命中集合是空的 —— 而空命中在朴素实现里正好等于「台账全部陈旧」（最刺眼的那个
 * 结论）。所以判决必须先看**失败计数**：任何一份没被真判过 ⇒ 判「没结论」（退 2），
 * 既不判红也不判绿（§13.6.2 的 `inconclusive` 同一口径）。oxlint 这边有两处会让
 * 「没判成」冒出来：解析失败的诊断**没有 `code`**（只有 message + severity error），
 * 以及输出里的 `number_of_files` 少于应扫份数。
 *
 * 用法：
 *   node scripts/check-eslint-exemptions.cjs            # 判真配置上那批文件级豁免
 *   node scripts/check-eslint-exemptions.cjs --report   # 只念读数，不参与退码
 * 退出码：0 台账与事实相符 / 1 有陈旧豁免（点名文件与那一块的位置）/
 *         2 没结论（任何一份没被判、台账形状变了、或条目是 glob 形状）。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/* 复用既有那份件对配置的读法：`loadOxlintConfig()` 是每进程一次的去重单飞
 * （`check-a11y-rules.cjs` 的文件头记着为什么只留一个读面），`normalize` 是规则档位的归一
 * （`"off"` 与 `["off"]` 同义）。这里不另写第二份配置加载器。 */
const { loadOxlintConfig, normalize } = require("./check-a11y-rules.cjs");

const TAG = "[eslint-exemptions]";
const ROOT = path.resolve(__dirname, "..");
/** #2777 PR-B：台账的**唯一出处**已随判决主体切到 oxlint 判决配置。 */
const OXLINT_CONFIG_REL = "oxlint.parity.config.mjs";
/** #2777 PR-C：取数改走 oxlint CLI，不再吃 eslint 运行期 API（`Linter` 已摘掉）。 */
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");

/**
 * 本判据核的那批**文件级**豁免台账 —— 逐条点名，不做「扫全部规则」的启发式。
 *
 * 为什么是名单而不是穷举：每条 core 规则的豁免台账要怎样才算「过时」是**各条自己的事**
 * （`no-control-regex` 的出口是「改用非正则方案」，别条未必有这种出口）。加一条就得
 * 先答出它那句「何时可移除」写在哪儿、由谁判 —— 答不出就不该进这张表。
 */
const FILE_LEVEL_EXEMPTIONS = [
  {
    ruleId: "no-control-regex",
    removalCriterion:
      "台账注释里的出口：若某文件改用非正则方案（逐字符过滤）处理控制字符，可把该文件从这里摘掉",
  },
];

/**
 * 一条文件级豁免块（从 `oxlint.parity.config.mjs` 的 `overrides` 里认出来的那种形状）。
 * @typedef {Object} ConfigBlock
 * @property {string | string[]} [files]
 * @property {Record<string, unknown>} [rules]
 */

/**
 * 从真配置里取出某条规则的**文件级**豁免条目。
 * @param {ConfigBlock[]} config
 * @param {string} ruleId
 * @returns {{ entries: string[], mentionedAnywhere: boolean }}
 *   `entries` 是逐字路径（原样，不去重不排序 —— 台账里写了几条就几条）；
 *   `mentionedAnywhere` 用来分「这条规则压根不在这份配置里（无事可判）」与
 *   「它出现过但没有 off 块（形状变了，取数落空）」—— 两者不能都当「没有陈旧」。
 */
function readFileLevelExemptions(config, ruleId) {
  /** @type {string[]} */
  const entries = [];
  let mentionedAnywhere = false;
  const offLevel = JSON.stringify("off");
  for (const block of config) {
    const setting = block.rules ? block.rules[ruleId] : undefined;
    if (setting !== undefined) {
      mentionedAnywhere = true;
    }
    if (normalize(setting) !== offLevel) {
      continue;
    }
    if (block.files === undefined) {
      continue;
    } // 规则级关停，不是文件级台账
    const list = Array.isArray(block.files) ? block.files : [block.files];
    for (const one of list) {
      entries.push(one);
    }
  }
  return { entries, mentionedAnywhere };
}

/**
 * 一次取数的结果。
 * @typedef {Object} ScanOutcome
 * @property {string[]} violating 现在**真有**命中的文件（逐字路径）
 * @property {{file: string, why: string}[]} failed 没能判定的一切（读不到 / 解析失败）
 * @property {number} scanned 实际过了规则本体的份数
 */

/**
 * oxlint 的 JSON 把规则名写成 `<plugin>(<rule>)`（core 规则记成 `eslint(...)`），
 * 台账这边用的是 eslint 的裸名 / `plugin/rule` 写法。归一成台账那套再逐字比。
 * @param {string | undefined | null} code
 * @returns {string | undefined}
 */
function normalizeOxlintCode(code) {
  if (typeof code !== "string") {
    return undefined;
  }
  const m = /^(?<plugin>\w+)\((?<rule>.+)\)$/.exec(code);
  if (!m) {
    return code;
  }
  const plugin = m.groups?.plugin;
  const rule = m.groups?.rule;
  return plugin === "eslint" ? rule : `${plugin}/${rule}`;
}

/**
 * 用**规则本体**量这批文件现在还有没有命中 —— 起一次 oxlint CLI。
 *
 * 判决配置对这批文件把目标规则关着（那正是被对账的台账），所以另起一份最小临时配置
 * 把它打开。临时件落在 `os.tmpdir()`（仓外，不进脚本档的单文件判决面），`finally` 删掉。
 *
 * @param {string[]} files 逐字相对路径
 * @param {string} ruleId 台账规则名（eslint 写法）
 * @param {string} root
 * @returns {{diagnostics: {code?: string | null, filename: string, message?: string, severity?: string}[],
 *            number_of_files?: number, status: number | null}}
 */
function runOxlintCli(files, ruleId, root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-oxlint-exempt-"));
  const configFile = path.join(dir, "probe.config.mjs");
  fs.writeFileSync(
    configFile,
    [
      "export default {",
      '  categories: { correctness: "off", suspicious: "off", perf: "off", style: "off",',
      '    restriction: "off", nursery: "off", pedantic: "off" },',
      `  rules: { ${JSON.stringify(ruleId)}: "error" },`,
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const res = spawnSync(
      process.execPath,
      [
        OXLINT_BIN,
        "--config",
        configFile,
        "--format",
        "json",
        ...files.map((rel) => path.join(root, rel)),
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (res.error) {
      throw new Error(`oxlint 起不来：${res.error.message}`);
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 出参：起不来 / 无输出时 stdout 实测为 null，@types/node 按非空标，保留空串兜底
    const text = (res.stdout ?? "").trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`oxlint 输出不是 JSON（退出码 ${res.status}）：${text.slice(0, 400)}`);
    }
    return {
      diagnostics: parsed.diagnostics ?? [],
      number_of_files: parsed.number_of_files,
      status: res.status,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不影响判决：它在仓外、按次命名。 */
    }
  }
}

/**
 * 量这批文件现在还有没有命中。
 * @param {{files: string[], ruleId: string, root: string,
 *          readFile?: (absPath: string) => string,
 *          runOxlint?: (files: string[]) => {diagnostics: {code?: string | null, filename: string, message?: string, severity?: string}[], number_of_files?: number, status?: number | null}}} p
 *   `readFile` / `runOxlint` 是注入缝：契约用例要能把「命中 / 没命中 / 解析失败 / 读不到」
 *   四种形状各喂一次，而不必往仓库里埋四份夹具文件（那些文件会被别的扫描面收去判），
 *   也不必每条用例都真起一次 CLI。
 * @returns {ScanOutcome}
 */
function scanViolations({ files, ruleId, root, readFile, runOxlint }) {
  /** @type {(absPath: string) => string} */
  const read = readFile ?? ((absPath) => /** @type {string} */ (fs.readFileSync(absPath, "utf8")));
  /** @type {string[]} */
  const violating = [];
  /** @type {{file: string, why: string}[]} */
  const failed = [];
  let scanned = 0;

  /* 先过一遍可读性：读不到的份**不进**取数（喂给 CLI 只会得到一条「文件不在输出里」，
   * 把设计内的跳过说成设计外的故障）。 */
  /** @type {string[]} */
  const readable = [];
  for (const rel of files) {
    try {
      read(path.join(root, rel));
      readable.push(rel);
    } catch (error) {
      /* `error` 是 catch 的 `unknown`：`code` 只在它是对象且真有字符串 `code` 时才取，
         取不到就与原来一样落 `message`（非 Error 的抛出物按 `String(error)` 拼）。 */
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : undefined;
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ file: rel, why: `读不到（${code ?? message}）` });
    }
  }

  if (readable.length === 0) {
    return { violating, failed, scanned };
  }

  let run;
  try {
    run = runOxlint ? runOxlint(readable) : runOxlintCli(readable, ruleId, root);
  } catch (error) {
    /* 起不来 / 输出不可解析 ⇒ 这一批全部「没判过」，判决必须是 inconclusive。 */
    for (const rel of readable) {
      failed.push({ file: rel, why: `oxlint 取数失败：${String(error).split("\n")[0]}` });
    }
    return { violating, failed, scanned: 0 };
  }

  /* `number_of_files` 是「真的解析了几份」的读数：少于应扫份数就不构成「每份都判过」。
   * 这一条挡的是「CLI 静默漏掉一整批文件，命中集合为空 ⇒ 被读成台账全陈旧」。 */
  if (typeof run.number_of_files === "number" && run.number_of_files !== readable.length) {
    failed.push({
      file: `(oxlint 只扫了 ${run.number_of_files} 份 / 应扫 ${readable.length} 份)`,
      why: "取数面比台账窄 —— 这一跑不构成「每份都判过」",
    });
  }

  /** @type {Map<string, {code?: string | null, filename: string, message?: string, severity?: string}[]>} */
  const byFile = new Map();
  for (const entry of run.diagnostics) {
    const abs = path.resolve(root, entry.filename);
    const list = byFile.get(abs) ?? [];
    list.push(entry);
    byFile.set(abs, list);
  }

  for (const rel of readable) {
    const messages = byFile.get(path.resolve(root, rel)) ?? [];
    /* 解析失败的诊断**没有 `code`**（只有 message + severity error）—— 它不算判过。 */
    const parseFailure = messages.find((m) => m.severity === "error" && !m.code);
    if (parseFailure) {
      failed.push({ file: rel, why: `解析失败：${parseFailure.message ?? "fatal"}` });
      continue;
    }
    scanned += 1;
    if (messages.some((m) => normalizeOxlintCode(m.code) === ruleId)) {
      violating.push(rel);
    }
  }
  return { violating, failed, scanned };
}

/**
 * 台账条目是不是 glob 形状。
 *
 * 单独抽出来，是因为**取数与判决两边要用同一个判据**：判决那边把它算进「没扫到的份数」，
 * 取数那边要按它把条目挡在 `readFileSync` 之外。两边各写一遍的形状，最后会读成
 * 「glob 是一份读不到的文件」—— 把设计内的跳过说成设计外的故障。
 * @param {string} entry
 * @returns {boolean}
 */
function isGlobEntry(entry) {
  return /[[\]*{]/.test(entry);
}

/**
 * 判决的输入与结论。
 * @typedef {Object} Verdict
 * @property {"pass" | "stale" | "inconclusive"} state
 * @property {string} ruleId
 * @property {string} removalCriterion 那条台账自己写的「何时可移除」—— 红了要把依据打出来，
 *   否则「摘掉它」这个出口是本脚本的偏好，不是配置里既有的口径
 * @property {string[]} stale 台账里有、事实里没有（这才是本脚本要抓的那一向）
 * @property {{file: string, why: string}[]} failed
 * @property {string[]} unresolvable 条目是 glob 形状，本脚本只认逐字路径
 * @property {number} entries
 * @property {number} violating
 * @property {number} scanned **真的过了规则本体**的份数 —— 打印必须用这一个数，
 *   用「台账条数 − 失败数」会把刻意没打开的 glob 条目也算成判过（实测就这么说过一次假话）
 */

/**
 * 纯判决（不碰文件系统，供用例直接把三件输入喂进来）。
 * @param {{ruleId: string, removalCriterion: string,
 *          entries: string[], violating: string[],
 *          failed: {file: string, why: string}[], scanned: number,
 *          mentionedAnywhere: boolean}} input
 * @returns {Verdict}
 */
function judge(input) {
  const { ruleId, removalCriterion, entries, violating, failed, scanned, mentionedAnywhere } =
    input;
  /* 只认逐字路径：glob 条目（`tests/helpers/**` 那种）要展开才知道覆盖了谁，
   * 而展开这一步一旦做错，「这份没命中」究竟是「真没命中」还是「压根没扫到」就分不开了。
   * 今天这张台账里 13 条全是逐字路径（实测），所以判「没结论」不是给自己添堵，
   * 是拒绝把一条没验过的展开逻辑放进承重位。 */
  const unresolvable = entries.filter(isGlobEntry);
  const judged = entries.length - unresolvable.length;
  /** @type {Verdict["state"]} */
  let state = "pass";
  if (failed.length > 0 || scanned !== judged) {
    state = "inconclusive";
  } else if (unresolvable.length > 0) {
    state = "inconclusive";
  } else if (entries.length === 0) {
    /* 台账为空有两种，必须分开：这条规则在配置里**根本没出现过**（真没有文件级豁免，
     * 无事可判）与「它出现过但没有 off 块」（台账被改了形状 / 我的认法失效）。
     * 后者是取数落空，不许读成「干净」。 */
    state = mentionedAnywhere ? "inconclusive" : "pass";
  } else if (entries.some((e) => !violating.includes(e))) {
    state = "stale";
  }
  return {
    state,
    ruleId,
    removalCriterion,
    stale: entries.filter((e) => !violating.includes(e)),
    failed,
    unresolvable,
    entries: entries.length,
    violating: violating.length,
    scanned,
  };
}

/**
 * @param {Verdict} v
 * @param {boolean} reportOnly
 * @returns {number} 退出码
 */
function printVerdict(v, reportOnly) {
  console.log(
    `${TAG} ${v.ruleId}：台账 ${v.entries} 条 · 判过 ${v.scanned} 份 · 真违例 ${v.violating} 份`,
  );
  if (reportOnly) {
    console.log(`${TAG} （--report：只念读数，不参与退码）`);
    return 0;
  }
  if (v.state === "inconclusive") {
    console.error(`${TAG} ✗ 没结论 —— 这一跑不构成「台账是干净的」：`);
    for (const f of v.failed) {
      console.error(`${TAG}   · ${f.file}：${f.why}`);
    }
    for (const g of v.unresolvable) {
      console.error(
        `${TAG}   · ${g}：glob 形状条目，本判据只认逐字路径（要判它，先展开成逐份文件）`,
      );
    }
    if (v.failed.length === 0 && v.unresolvable.length === 0) {
      console.error(
        `${TAG}   · 台账读出来是空的，但这条规则在配置里出现过 —— 要么那块换了形状，` +
          `要么本脚本的认法跟不上；两种都不许读成「没有陈旧豁免」。`,
      );
    }
    console.error(
      `${TAG}   （命中 0 份 ≠ 对象没有：本仓被这条坑过，见 §13.6.2 的 inconclusive。）`,
    );
    return 2;
  }
  if (v.state === "stale") {
    console.error(
      `${TAG} ✗ 有 ${v.stale.length} 条**陈旧豁免**：台账还关着这条规则，而那些文件里已经没有命中了。`,
    );
    for (const s of v.stale) {
      console.error(`${TAG}   · ${s}`);
    }
    console.error(
      `${TAG} 出口：从 ${OXLINT_CONFIG_REL} 的那块 files 数组里把上面这些摘掉（还在违例的那些留着）。`,
    );
    console.error(`${TAG} 依据：${v.removalCriterion}。`);
    console.error(
      `${TAG} 为什么这条要拦：豁免台账是「谁在替这条规则回答『这里为什么可以』」的那份账；` +
        `留着已经不需要的豁免，等于让下一个读者以为那份文件还依赖它。`,
    );
    return 1;
  }
  console.log(`${TAG} ✓ 台账与事实相符（${v.entries} 条都还在承重）。`);
  return 0;
}

async function main() {
  const reportOnly = process.argv.includes("--report");
  /** @type {ConfigBlock[]} */
  let config;
  try {
    const oxlintConfig = await loadOxlintConfig();
    config = Array.isArray(oxlintConfig.overrides) ? oxlintConfig.overrides : [];
  } catch (error) {
    console.error(
      `${TAG} ✗ 取不到 ${OXLINT_CONFIG_REL} 的求值结果 ⇒ 没结论（不是「台账是干净的」）：`,
      String(error).split("\n")[0],
    );
    return 2;
  }
  let worst = 0;
  for (const { ruleId, removalCriterion } of FILE_LEVEL_EXEMPTIONS) {
    const { entries, mentionedAnywhere } = readFileLevelExemptions(config, ruleId);
    /* glob 条目**不进**取数：它们没有可打开的路径，喂给 `readFileSync` 只会得到
     * 一条「读不到的文件」，把设计内的形状说成设计外的故障（判决那边用同一个
     * `isGlobEntry` 认它们，见函数头的理由）。 */
    const literal = entries.filter((e) => !isGlobEntry(e));
    const scan = scanViolations({ files: literal, ruleId, root: ROOT });
    const verdict = judge({
      ruleId,
      removalCriterion,
      entries,
      violating: scan.violating,
      failed: scan.failed,
      scanned: scan.scanned,
      mentionedAnywhere,
    });
    worst = Math.max(worst, printVerdict(verdict, reportOnly));
  }
  return worst;
}

/* 导出给用例：`judge` 是纯判决（夹具直接喂三件输入），`readFileLevelExemptions` /
 * `scanViolations` 是两个取数层（后者开着 `readFile` / `makeLinter` 两道缝，
 * 让「命中 / 未命中 / 读不到 / 解析失败」四种形状都能各喂一次而不必往仓里埋夹具），
 * `isGlobEntry` 是**取数与判决两边共用**的那一个形状判据（各写一遍就会出现
 * 「glob 被当成读不到的文件」那种读数）。
 * 不导出 `main` —— 入口只有一条（`node scripts/check-eslint-exemptions.cjs`）。 */
module.exports = {
  judge,
  isGlobEntry,
  readFileLevelExemptions,
  scanViolations,
  FILE_LEVEL_EXEMPTIONS,
};

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}
