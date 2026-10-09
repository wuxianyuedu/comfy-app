#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：jsx-a11y 规则开关 ⇄ 判据的双向判据（供 .githooks/pre-commit 的 D 组调用）
/**
 * `jsx-a11y` 的规则开关 ⇄ 判据 —— 规范见 docs/standards/06-无障碍访问-a11y.md §6.12。
 *
 * ── 立案现场：装了 39 条规则，只启用 6 条，而「装了没用」这件事没有判据 ────
 *
 * `eslint-plugin-jsx-a11y@6.10.2` **装着 39 条规则**，`eslint.config.js`（经
 * `eslint-config-next`）只启用 **6 条**、且全是 `warn`。剩下那批里有一批
 * **本来会响的真形态**：
 *
 *   · `anchor-has-content` —— 锚点没有可访问内容（本仓实测 1 处：Base UI 的
 *     `render` 通道转发内容，规则看不穿的**误报**，就地豁免）；
 *   · `media-has-caption` —— `<video>` 没有字幕轨；
 *   · `no-autofocus` —— 4 处；
 *   · `label-has-associated-control` —— 基元 `<label>` 的关联；
 *   · `no-static-element-interactions` / `click-events-have-key-events` /
 *     `no-noninteractive-element-interactions` —— 这条是**同一条账的三档**，
 *     本轮之前由 `check-click-keyboard.cjs`（§6.11）在守，现在两条并存。
 *
 * 也就是说：这个插件此前是**半开的**，而「半开」这件事**没有任何东西在数**
 * —— `grep -c jsx-a11y eslint.config.js` 是 0（配置在 `eslint-config-next`
 * 里）、`grep -c a11y scripts/check-*.cjs` 只有 `check-click-keyboard` 那一处
 * 形态判据。规则开关本身（哪条开着、哪条关着、关的理由是谁在守）一个执行者
 * 都没有。这与 §13.5.12 的立案现场（判据自称在跑、实际没有执行者）同族，
 * 只是这次「判据」是一条 npm 包里的规则。
 *
 * ── 判据（三向，都由本脚本强制）──────────────────────────────────────
 *
 * 1. **官方 `recommended` 集合必须全开** —— 以**插件自己的那份数据**为准
 *   （`a11yRecommendedRules()` 现场算出来，不是在脚本里抄一份规则表）：
 *     · 官方给 `"off"` 的（`anchor-ambiguous-text` / `label-has-for`）不算
 *       「该开」—— 它们进不了 recommended 的有效集合；
 *     · 官方给 options 的（`control-has-associated-label` 等）**必须带上官方
 *       那份 options**：少了它规则退回默认档、结论不同（实测
 *       `control-has-associated-label` 的官方 options 里 `includeRoles` 有
 *       `dialog` / `alert`，默认档没有）。
 * 2. **本仓与官方默认的每一处不同都必须登记**（`scripts/.a11y-rule-ledger.json`
 *   的 `dialect`）：关掉一条、改一条的选项档，都要答出「为什么」+「谁在守它」。
 *   没登记 = 有人偷偷关掉一条真判据，且没有任何东西会响。
 * 3. **台账双向拦**：登记了「关掉」而它其实开着 ⇒ 红（台账是负债，不是赦免
 *   名单）；登记了一条不存在的规则 ⇒ 红（改名 / 换插件后留下的孤儿条目）。
 *
 * **`inlineExemptions` 是第三档**：规则开着、但某个文件里就地
 * `eslint-disable` 了。它由 `eslint --report-unused-disable-directives` 那
 * 一侧管着「disable 了却不需要」；本脚本管的是「这条豁免必须被登记」——
 * 因为就地关掉一条规则**在配置层完全看不见**。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯本地：读 `eslint.config.js`（动态 import，实测 ~0.4s —— 它要经
 * `eslint-config-next` 把整个 next 配置求值一遍）、读台账、比数组。零网络、
 * 零子进程。照 §13.5.4 的成本判据该进钩子。
 *
 * 用法：
 *   node scripts/check-a11y-rules.cjs                    # 检查（进 pre-commit D 组）
 *   node scripts/check-a11y-rules.cjs --report           # 只出清单不判失败（盘点用）
 *   node scripts/check-a11y-rules.cjs --ledger <path>    # 换一份台账来判（自测用）
 *
 * `--ledger <path>` 是**纯增量口子**：默认行为一个字不变（不传就是仓库里那份
 * `scripts/.a11y-rule-ledger.json`），传了就拿它当台账读。它存在的原因只有一个 ——
 * 门禁自测（`tests/a11y-rules-gate.test.ts`）要拿**十来份不同的台账**各判一次，
 * 而没有这个口子时用例只能「备份真台账 → 覆盖 → 跑 → 还原」：那是**共享可变状态**，
 * 于是那些用例既不能并发（互相踩），也无法在失败时保证还原（§11.19.2 那一族）。
 * 台账路径是**被测输入**，就该像 `check-format.cjs` 的 `NODE_PATH` 一样是个显式入参。
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const { REPORT_ONLY, LEDGER } = parseArgs(process.argv.slice(2));

const ESLINT_CONFIG = path.join(ROOT, "eslint.config.js");

/**
 * 解析命令行：`--report` 与 `--ledger <path>`。
 *
 * `--ledger` 取**下一个参数**当路径（不认 `--ledger=…` 那种形态：调用点只有
 * 门禁自测一处，不为一种用不上的写法多留一条分支）。缺值 = 用法错，直接退 2 ——
 * 静默退回真台账是最坏的结果：用例以为在判自己的夹具，其实在判真库（绿得毫无意义）。
 */
function parseArgs(argv) {
  let ledger = path.join(__dirname, ".a11y-rule-ledger.json");
  let report = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--report") report = true;
    else if (argv[i] === "--ledger") {
      const next = argv[i + 1];
      if (
        typeof next !== "string" ||
        next.trim() === "" ||
        next.startsWith("--")
      ) {
        console.error("[a11y-rules] --ledger 后面要跟一个台账文件路径。");
        process.exit(2);
      }
      ledger = path.resolve(ROOT, next);
      i += 1;
    }
  }
  return { REPORT_ONLY: report, LEDGER: ledger };
}

/** 规则名前缀 —— 只盘点这个插件。 */
const PREFIX = "jsx-a11y/";

/**
 * 读出「生效的 jsx-a11y 规则表」：**求值真的 `eslint.config.js`**，而不是
 * 在这里再解析一遍它。
 *
 * 为什么要走真的那份配置（实测踩出来的）：第一版在这里自己 `import` 插件、
 * 自己算 recommended —— 于是「配置里其实关掉了某条」这件事**完全看不见**，
 * 判据恒绿。判据要判的对象是**生效的那一份**，那就必须求值它。
 *
 * 求值路径：`eslint.config.js` 是 ESM（顶层 await）、且它自己 import 了
 * `eslint-config-next` —— 用 `pathToFileURL` + 动态 `import()` 起在同一进程里。
 * 副作用只有「读几份包」，零网络。
 */
async function effectiveRules() {
  const mod = await import(pathToFileURL(ESLINT_CONFIG).href);
  /** @type {{rules?: Record<string, unknown>}[]} */
  const flat = mod.default.flat();
  /** 扁平配置按数组顺序合并，**后者覆盖前者** —— 取最后一次出现。 */
  const merged = {};
  for (const config of flat) {
    if (!config.rules) continue;
    for (const [name, setting] of Object.entries(config.rules)) {
      if (name.startsWith(PREFIX)) merged[name] = setting;
    }
  }
  return merged;
}

/**
 * 官方 `recommended` 的**有效集合**（去 off）+ 每条的 options。
 *
 * 从**配置里已经装好的插件对象**取（`eslint-config-next` 带进来的那一个）：
 * 本仓没有 `eslint-plugin-jsx-a11y` 直接依赖，pnpm 严格布局下顶层与
 * `import.meta.resolve` 都解析不到。口径与 `eslint.config.js` 的
 * `a11yRecommendedRules()` **同源**（那一份是配置，这一份是判据，两边都从
 * 插件对象算 —— 不各抄一份规则表）。
 */
async function officialRecommended() {
  const mod = await import(pathToFileURL(ESLINT_CONFIG).href);
  const flat = mod.default.flat();
  let plugin = null;
  for (const config of flat) {
    if (config.plugins?.["jsx-a11y"]) plugin = config.plugins["jsx-a11y"];
  }
  if (!plugin) {
    throw new Error(
      "配置里没有 jsx-a11y 插件对象 —— eslint.config.js 的结构变了？" +
        "本判据从它那里读官方 recommended 集合（不手抄规则表）。",
    );
  }
  const rec = plugin.configs.recommended.rules;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [name, setting] of Object.entries(rec)) {
    if (setting === "off") continue;
    out[name] = Array.isArray(setting) ? setting[1] : undefined;
  }
  return out;
}

/**
 * 台账里登记为「本仓刻意改档」的规则名 —— 只认**理由与 keeper 都写全**的那些。
 * 写不全的条目仍要在 ① 里红（它没有资格豁免官方那一条）。
 */
function registeredDialectRules() {
  const { dialect } = readLedger();
  const out = new Set();
  for (const entry of dialect) {
    if (!entry || typeof entry.rule !== "string") continue;
    if (entry.decision !== "off") continue;
    if (typeof entry.why !== "string" || entry.why.trim() === "") continue;
    if (typeof entry.keeper !== "string" || entry.keeper.trim() === "")
      continue;
    out.add(entry.rule);
  }
  return out;
}

function readLedger() {
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
    return {
      dialect: Array.isArray(raw.dialect) ? raw.dialect : [],
      inlineExemptions: Array.isArray(raw.inlineExemptions)
        ? raw.inlineExemptions
        : [],
    };
  } catch {
    return { dialect: [], inlineExemptions: [] };
  }
}

/**
 * 插件里**全部规则的元数据**（名字 → `{ deprecated }`）。
 *
 * 第三档判据（「官方两份配置谁都没提到」）要区分两件事：
 *   · 官方**标了废弃**的（`meta.deprecated === true`）—— 不提是对的，
 *     本仓也不该提；
 *   · **既没标废弃、又不在任何一份配置里**的 —— 那只是被两份**手写的静态
 *     清单**漏掉了，「该不该开」从来没有人决定过。
 * 后者才是要判的。
 *
 * 判据**从插件自己的 `meta` 读废弃状态**，不在这里抄一份废弃名单 ——
 * 抄一份就会漂（插件升版改了 `meta` 我们一个字都不会变），与
 * `officialRecommended()` 从插件对象算集合是同一个口径。
 */
async function officialRuleMap() {
  const mod = await import(pathToFileURL(ESLINT_CONFIG).href);
  const flat = mod.default.flat();
  let plugin = null;
  for (const config of flat) {
    if (config.plugins?.["jsx-a11y"]) plugin = config.plugins["jsx-a11y"];
  }
  if (!plugin || typeof plugin.rules !== "object" || plugin.rules === null) {
    throw new Error(
      "配置里读不到 jsx-a11y 的 rules 表 —— eslint.config.js 的结构变了？" +
        "本判据从它读每条规则的废弃状态（不手抄废弃名单）。",
    );
  }
  /** @type {Map<string, { deprecated: boolean }>} */
  const out = new Map();
  for (const [name, rule] of Object.entries(plugin.rules)) {
    out.set(`${PREFIX}${name}`, {
      deprecated: rule && rule.meta ? rule.meta.deprecated === true : false,
    });
  }
  return out;
}

/**
 * 官方两份配置（`recommended` / `strict`）**谁都没提到**的规则。
 *
 * 立案现场（本批）：`jsx-a11y@6.10.2` 装着 39 条，而这两份是
 * `lib/index.js` 里**手写的静态清单** —— 实测 **5 条两边都没被提到**，
 * 其中 3 条官方标了 ❌ deprecated（不提是对的），剩下 **3 条既非废弃、
 * 也非明写 off**（`lang` / `no-aria-hidden-on-focusable` /
 * `prefer-tag-over-role`）：它们只是被两份清单漏掉了，于是
 * 「该不该开」**从来没有人决定过**，也没有任何东西会响。
 *
 * 这与「官方 recommended 里被悄悄关掉」是同一个洞的另一面 ——
 * 本判据原来只堵了前一半（③ 那一向），「没被列进来」那一半一直敞着。
 */
async function rulesInNeitherConfig() {
  const mod = await import(pathToFileURL(ESLINT_CONFIG).href);
  const flat = mod.default.flat();
  let plugin = null;
  for (const config of flat) {
    if (config.plugins?.["jsx-a11y"]) plugin = config.plugins["jsx-a11y"];
  }
  if (!plugin) throw new Error("配置里没有 jsx-a11y 插件对象。");
  const mentionedBy = (config) => {
    const rules = config && config.rules ? config.rules : {};
    return (name) => rules[name] !== undefined;
  };
  const inRecommended = mentionedBy(plugin.configs.recommended);
  const inStrict = mentionedBy(plugin.configs.strict);
  /** @type {string[]} */
  const out = [];
  for (const name of (await officialRuleMap()).keys()) {
    if (inRecommended(name) || inStrict(name)) continue;
    out.push(name);
  }
  return out;
}

/** 把规则设置归一成可比较的形状：`"error"` 与 `["error", 5]` 不同、`"error"` 与 `["error"]` 同。 */
function normalize(setting) {
  if (Array.isArray(setting)) {
    const [level, ...rest] = setting;
    if (rest.length === 0) return JSON.stringify(level);
    return JSON.stringify([level, ...rest]);
  }
  return JSON.stringify(setting);
}

async function main() {
  const effective = await effectiveRules();
  const recommended = await officialRecommended();
  const official = await officialRuleMap();
  const inNeither = await rulesInNeitherConfig();
  const ledger = readLedger();
  const registered = registeredDialectRules();
  const isRegisteredDialect = (name) => registered.has(name);

  const problems = [];

  /* ① 官方 recommended 的每一条都必须开着、且 options 与官方逐字一致。
   *
   * 「本仓刻意改档」的那几条（台账 dialect 里登记过、且**理由与 keeper 都写全**的）
   * 从这一向里豁免 —— 它们由 ② 那一向管（台账 ⇄ 生效 双向）。不这样切的话，
   * 台账会变成一份**死账**：要么写不进去（① 恒红），要么写成「官方这条我们不看」
   * 却仍然要过 ①（同一件事两处打架）。 */
  for (const [name, options] of Object.entries(recommended)) {
    if (isRegisteredDialect(name)) continue;
    if (!(name in effective)) {
      problems.push(
        `官方 recommended 的 ${name} **没开**（配置里查不到这条规则）。\n` +
          "    → 它要么被 next 配置的胜出档关掉了，要么本批的 a11yRecommendedRules() 没把它带进来。",
      );
      continue;
    }
    const want = normalize(
      options === undefined ? "error" : ["error", options],
    );
    const got = normalize(effective[name]);
    if (got !== want) {
      problems.push(
        `官方 recommended 的 ${name} 档位与官方不一致：\n` +
          `      生效 = ${got}\n      官方 = ${want}\n` +
          "    → 官方那份 options 少了会让规则退回默认档、结论不同。",
      );
    }
  }

  /* ② 台账里登记的每一处「方言」必须是真的关着 / 真的改了档 —— 双向拦。 */
  const dialectByRule = new Map();
  for (const entry of ledger.dialect) {
    if (!entry || typeof entry.rule !== "string") {
      problems.push("台账 dialect 里有一条缺 `rule` 字段。");
      continue;
    }
    dialectByRule.set(entry.rule, entry);
    if (typeof entry.why !== "string" || entry.why.trim() === "") {
      problems.push(
        `台账 dialect 的 ${entry.rule} 没写「为什么」—— 空理由没有记账价值。`,
      );
    }
    if (typeof entry.keeper !== "string" || entry.keeper.trim() === "") {
      problems.push(
        `台账 dialect 的 ${entry.rule} 没写「谁在守它」——` +
          "关掉一条判据却不答出替代者，等于把它从面上删掉。",
      );
    }
  }
  for (const [rule, entry] of dialectByRule) {
    if (!(rule in effective)) {
      problems.push(
        `台账 dialect 登记了 ${rule}，但生效配置里根本没这条规则（改名 / 换插件后的孤儿条目）。`,
      );
      continue;
    }
    const decided = entry.decision === "off" ? "off" : null;
    if (decided === "off" && effective[rule] !== "off") {
      problems.push(
        `台账 dialect 说 ${rule} 关着，而它实际是 ${normalize(effective[rule])} —— ` +
          "登记的是负债，不是赦免名单（真开了就把它从台账里摘掉）。",
      );
    }
  }

  /* ③ 官方 recommended 里被本仓关掉的每一条都必须登记 —— 没登记 = 悄悄关掉了判据。 */
  for (const name of Object.keys(recommended)) {
    if (effective[name] !== "off") continue;
    if (dialectByRule.has(name)) continue;
    problems.push(
      `${name} 属官方 recommended 却被关掉了，而台账里没有登记。\n` +
        "    → 要么把它开回来，要么在 scripts/.a11y-rule-ledger.json 的 dialect 里\n" +
        "      写明「为什么本仓这一档不同」与「谁在守它」。",
    );
  }

  /* ⑤ **官方两份配置谁都没提到**的非废弃规则，本仓必须有一笔裁决。
   *
   * 这是本批补的那一半洞。原来只判「官方 recommended 里被关掉的」（③），
   * 而「压根没被列进任何一份配置」这件事没人管 —— 实测 5 条，其中 3 条官方
   * 标了 deprecated（不提是对的，跳过），剩下 3 条要么**开着**（本仓做了决定、
   * 写进 eslint.config.js 的第三档），要么**在台账里登记为关着**（含 keeper）。
   * 两条都不满足 = 没有人决定过 —— 与「没登记就关掉一条真判据」同罪。 */
  for (const name of inNeither) {
    const meta = official.get(name);
    if (meta && meta.deprecated) continue;
    const off = effective[name] === "off";
    if (!off && name in effective) continue;
    if (dialectByRule.has(name)) continue;
    problems.push(
      `${name} 既不在官方 recommended、也不在官方 strict（而它**没有**被标记废弃）——` +
        "本仓对它的裁决没有任何痕迹。\n" +
        "    → 要么在 eslint.config.js 里明确开出这一档，要么在\n" +
        "      scripts/.a11y-rule-ledger.json 的 dialect 里写明「为什么不开」与「谁在守它」。\n" +
        "      （新建规则时插件常先不加进两份配置 —— 正是「没人决定过」的高发处。）",
    );
  }

  /* ④ 就地豁免的文件与理由都要在。 */
  for (const entry of ledger.inlineExemptions) {
    if (
      !entry ||
      typeof entry.rule !== "string" ||
      typeof entry.file !== "string"
    ) {
      problems.push("台账 inlineExemptions 里有一条缺 `rule` 或 `file` 字段。");
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, entry.file))) {
      problems.push(
        `台账 inlineExemptions 里的 ${entry.file} 不存在（文件改名 / 搬走了？）。`,
      );
    }
    if (
      typeof entry.why !== "string" ||
      entry.why.trim() === "" ||
      typeof entry.keeper !== "string" ||
      entry.keeper.trim() === ""
    ) {
      problems.push(
        `台账 inlineExemptions 的 ${entry.rule}（${entry.file}）缺「为什么」或「谁在守它」。`,
      );
    }
  }

  const undecidedCount = inNeither.filter(
    (n) => !(official.get(n) || {}).deprecated,
  ).length;
  const onCount = Object.values(effective).filter((v) => v !== "off").length;
  const summary =
    `[a11y-rules] 生效 ${onCount} 条 / 官方 recommended ${Object.keys(recommended).length} 条；` +
    `方言 ${ledger.dialect.length} 条、就地豁免 ${ledger.inlineExemptions.length} 条；` +
    `官方两份都没提到且未废弃 ${undecidedCount} 条（已逐条裁决）。`;

  if (REPORT_ONLY) {
    console.log(summary);
    for (const [name, setting] of Object.entries(effective).sort()) {
      console.log(
        `  ${setting === "off" ? "·" : "*"} ${name} = ${normalize(setting)}`,
      );
    }
    console.log("\n[a11y-rules] --report 模式：只出清单，不判失败 ✓");
    return 0;
  }

  if (problems.length > 0) {
    console.error(
      "[a11y-rules] jsx-a11y 的规则开关与台账对不上：\n\n  " +
        problems.join("\n  ") +
        "\n\n口径见 docs/standards/06-无障碍访问-a11y.md §6.12。",
    );
    return 1;
  }

  console.log(summary);
  return 0;
}

module.exports = { normalize };

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[a11y-rules] 判据自己崩了：${error.message}`);
      process.exit(1);
    },
  );
}
