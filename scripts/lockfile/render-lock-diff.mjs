/**
 * render-lock-diff.mjs — 把 lock-diff 的结构化差异渲染成控制台文本。
 *
 * 与 lock-diff.mjs 分工：那边只做解析与对比（无 IO、可单测），这边只管措辞与
 * 排版。Windows 控制台是 GBK 之外的代码页问题重灾区（AGENTS 硬规则 11），
 * 因此正文**只用 ASCII 字符**（→ 写成 ->，✔/✗ 写成 [OK]/[!]），中文由调用方
 * （PowerShell 入口 / 终端）按 UTF-8 输出。
 */

/** 解析版本串（`16.3.2(@babel/…)`）→ 只留版本号，去掉 peer 依赖尾巴。
 *
 * @param {string | undefined} v
 * @returns {string}
 */
export function shortVersion(v) {
  if (!v) {
    return "(无)";
  }
  const m = /^([^\s(]+)/.exec(v);
  const [, head = v] = m ?? [];
  return head;
}

/** 包名 + 版本 → 单行描述（packages/snapshots 段的键就是 `name@version`）。
 *
 * @param {string} key
 * @returns {string}
 */
function entryLabel(key) {
  return key;
}

/**
 * @param {string[]} list
 * @param {number} max
 * @param {(item: string) => string} render
 * @returns {string[]}
 */
function cap(list, max, render) {
  const shown = list.slice(0, max).map(render);
  if (list.length > max) {
    shown.push(`  ... 另有 ${list.length - max} 项，见上方完整输出/日志`);
  }
  return shown;
}

/** 依赖组名 → 中文标签。**按 `Record<string, string>` 记账**：组的键来自 diff，
 * 不是这四个字面量，按字面量对象索引会被 TS 判成「拿 string 索引固定形状」。 */
/** @type {Record<string, string>} */
const GROUP_LABELS = {
  dependencies: "dependencies（运行时依赖）",
  devDependencies: "devDependencies（开发依赖）",
  optionalDependencies: "optionalDependencies（可选依赖）",
  peerDependencies: "peerDependencies（同伴依赖）",
};

/**
 * 渲染差异。
 *
 * `diff` 的形状**不在此处重述**：它由 `lock-diff.mjs` 的 `LockDiff` typedef 定义一次，
 * 这里指过去 —— 上一版写的是 `@param {object}`，于是那十格 `TS2339`
 * （`Property 'settings' does not exist on type 'object'`）说的其实是「注解把已经存在的
 * 权威声明丢掉了」，不是代码错了（ISSUE #2589 批 5）。
 *
 * @param {import("./lock-diff.mjs").LockDiff} diff diffLockfiles 的返回值
 * @param {{ maxPerSection?: number }} [opts] 每段最多列几行（超出折叠），缺省 8
 * @returns {string[]} 行数组（不含换行符）
 */
export function renderLockDiff(diff, opts = {}) {
  const max = opts.maxPerSection ?? 8;
  /** @type {string[]} */
  const lines = [];

  if (diff.lockfileVersion) {
    lines.push(`  [配置] lockfileVersion: ${diff.lockfileVersion}`);
  }
  /**
   * 两段扁平表各配一个中文标签。写成**带类型的元组数组**而不是裸字面量：
   * 裸的 `[["settings…", diff.settings], …]` 会被推成 `(string | FlatDiff)[]`，
   * 解构出来的 `d` 于是是「`string | FlatDiff | undefined`」—— 那几格 `TS2339`
   * 报的不是代码错，是**标签与值被折进同一个联合**这件写法上的事。
   *
   * @type {Array<[string, import("./lock-diff.mjs").FlatDiff]>}
   */
  const flatSections = [
    ["settings（安装设置）", diff.settings],
    ["overrides（版本强制覆盖）", diff.overrides],
  ];
  for (const [label, d] of flatSections) {
    for (const it of d.added) {
      lines.push(`  [配置] ${label} 新增: ${it.key} = ${it.value}`);
    }
    for (const it of d.removed) {
      lines.push(`  [配置] ${label} 删除: ${it.key}（原 ${it.value}）`);
    }
    for (const it of d.changed) {
      lines.push(`  [配置] ${label} 变更: ${it.key}: ${it.from} -> ${it.to}`);
    }
  }

  /* 键与值一起取（`Object.entries`）：`diff.importers[importer]` 那种按下标取，
   * 在 `noUncheckedIndexedAccess` 之下每次都「可能 undefined」，而这里明明是从
   * `Object.keys` 拿到的键 —— 那是类型读不出来的事实，换成 entries 就是同一段代码、
   * 不需要造一条不可能的兜底分支。 */
  if (Object.keys(diff.importers).length) {
    lines.push("  [直接依赖]");
  }
  for (const [importer, groups] of Object.entries(diff.importers)) {
    for (const [group, g] of Object.entries(groups)) {
      const label = GROUP_LABELS[group] || group;
      /** @type {string[]} */
      const rows = [];
      /* `added` / `removed` 那两路里 `value` 恒在（`diffImporters` 就是这么造的），
       * 但 `DepChange` 这个形状同时服务 `changed`（那一路没有 `value`），所以类型上它是
       * 可选 —— 这里按类型走 `?.`，落不到的那一格退成 `"*"` / `(无)`，与现行为同形
       * （原来那两句 `it.value.specifier` 在这一格真为 undefined 时是抛 TypeError，
       * 而它构造上不可达）。 */
      for (const it of g.added) {
        rows.push(
          `+ ${it.name}  ${it.value?.specifier ?? "*"} -> ${shortVersion(it.value?.version)}`,
        );
      }
      for (const it of g.removed) {
        rows.push(
          `- ${it.name}  ${it.value?.specifier ?? "*"} -> ${shortVersion(it.value?.version)}`,
        );
      }
      for (const it of g.changed) {
        const spec =
          it.fromSpecifier === it.specifier
            ? it.specifier
            : `${it.fromSpecifier} -> ${it.specifier}`;
        rows.push(`~ ${it.name}  ${spec}：${shortVersion(it.from)} -> ${shortVersion(it.to)}`);
      }
      lines.push(`    ${label}（${importer}）共 ${rows.length} 项变化:`);
      for (const r of cap(rows, max, (x) => x)) {
        lines.push(`      ${r}`);
      }
    }
  }

  /** 同上：条目级两段各配一个标签，形状写在类型上而不是让 TS 去折联合。
   *
   * @type {Array<[string, import("./lock-diff.mjs").EntryDiff]>}
   */
  const entrySections = [
    ["解析结果 packages", diff.packages],
    ["解析结果 snapshots", diff.snapshots],
  ];
  for (const [label, d] of entrySections) {
    if (!d.added.length && !d.removed.length) {
      continue;
    }
    lines.push(`  [${label}] 新增 ${d.added.length} 项 / 删除 ${d.removed.length} 项`);
    for (const k of cap(d.added, max, (x) => `+ ${entryLabel(x)}`)) {
      lines.push(`      ${k}`);
    }
    for (const k of cap(d.removed, max, (x) => `- ${entryLabel(x)}`)) {
      lines.push(`      ${k}`);
    }
  }

  const dup = [...(diff.duplicates?.old || []), ...(diff.duplicates?.new || [])];
  if (dup.length) {
    lines.push(
      `  [注意] lockfile 里出现重复段落：${[...new Set(dup)].join(" / ")} —— ` +
        `常见于合并冲突或 install 被中断，建议删除 lockfile 后重新 pnpm install 生成。`,
    );
  }

  return lines;
}

/** 把「安装时 lockfile」与「仓库 lockfile」的差异渲染成用户可读的多行文本。
 *
 * @param {import("./lock-diff.mjs").LockDiff} diff
 * @param {{maxPerSection?: number}} [opts]
 * @returns {string[]}
 */
export function renderDriftReport(diff, opts = {}) {
  const lines = [];
  lines.push(
    "依赖与 lockfile 不一致，差异如下（仓库 pnpm-lock.yaml 与最近一次安装时的 lockfile 对比）：",
  );
  lines.push("");
  const body = renderLockDiff(diff, opts);
  if (!body.length) {
    lines.push("  两份 lockfile 的实质内容一致（差异仅在注释/空行/条目顺序）。");
    lines.push("  若仍被判为不一致，可在项目根执行 pnpm install 让两者对齐。");
    return lines;
  }
  return [...lines, ...body];
}
