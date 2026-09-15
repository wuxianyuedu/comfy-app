/**
 * render-lock-diff.mjs — 把 lock-diff 的结构化差异渲染成控制台文本。
 *
 * 与 lock-diff.mjs 分工：那边只做解析与对比（无 IO、可单测），这边只管措辞与
 * 排版。Windows 控制台是 GBK 之外的代码页问题重灾区（AGENTS 硬规则 11），
 * 因此正文**只用 ASCII 字符**（→ 写成 ->，✔/✗ 写成 [OK]/[!]），中文由调用方
 * （PowerShell 入口 / 终端）按 UTF-8 输出。
 */

/** 解析版本串（`16.3.2(@babel/…)`）→ 只留版本号，去掉 peer 依赖尾巴。 */
export function shortVersion(v) {
  if (!v) return "(无)";
  const m = /^([^\s(]+)/.exec(v);
  return m ? m[1] : v;
}

/** 包名 + 版本 → 单行描述（packages/snapshots 段的键就是 `name@version`）。 */
function entryLabel(key) {
  return key;
}

function cap(list, max, render) {
  const shown = list.slice(0, max).map(render);
  if (list.length > max) shown.push(`  ... 另有 ${list.length - max} 项，见上方完整输出/日志`);
  return shown;
}

const GROUP_LABELS = {
  dependencies: "dependencies（运行时依赖）",
  devDependencies: "devDependencies（开发依赖）",
  optionalDependencies: "optionalDependencies（可选依赖）",
  peerDependencies: "peerDependencies（同伴依赖）",
};

/**
 * 渲染差异。
 * @param {object} diff diffLockfiles 的返回值
 * @param {object} [opts]
 * @param {number} [opts.maxPerSection=8] 每段最多列几行（超出折叠）
 * @returns {string[]} 行数组（不含换行符）
 */
export function renderLockDiff(diff, opts = {}) {
  const max = opts.maxPerSection ?? 8;
  const lines = [];

  if (diff.lockfileVersion) {
    lines.push(`  [配置] lockfileVersion: ${diff.lockfileVersion}`);
  }
  for (const [label, d] of [
    ["settings（安装设置）", diff.settings],
    ["overrides（版本强制覆盖）", diff.overrides],
  ]) {
    for (const it of d.added) lines.push(`  [配置] ${label} 新增: ${it.key} = ${it.value}`);
    for (const it of d.removed) lines.push(`  [配置] ${label} 删除: ${it.key}（原 ${it.value}）`);
    for (const it of d.changed) lines.push(`  [配置] ${label} 变更: ${it.key}: ${it.from} -> ${it.to}`);
  }

  const importers = Object.keys(diff.importers);
  if (importers.length) lines.push("  [直接依赖]");
  for (const importer of importers) {
    const groups = diff.importers[importer];
    for (const group of Object.keys(groups)) {
      const g = groups[group];
      const label = GROUP_LABELS[group] || group;
      const rows = [];
      for (const it of g.added) rows.push(`+ ${it.name}  ${it.value.specifier || "*"} -> ${shortVersion(it.value.version)}`);
      for (const it of g.removed) rows.push(`- ${it.name}  ${it.value.specifier || "*"} -> ${shortVersion(it.value.version)}`);
      for (const it of g.changed) {
        const spec = it.fromSpecifier === it.specifier ? it.specifier : `${it.fromSpecifier} -> ${it.specifier}`;
        rows.push(`~ ${it.name}  ${spec}：${shortVersion(it.from)} -> ${shortVersion(it.to)}`);
      }
      lines.push(`    ${label}（${importer}）共 ${rows.length} 项变化:`);
      for (const r of cap(rows, max, (x) => x)) lines.push(`      ${r}`);
    }
  }

  for (const [label, d] of [
    ["解析结果 packages", diff.packages],
    ["解析结果 snapshots", diff.snapshots],
  ]) {
    if (!d.added.length && !d.removed.length) continue;
    lines.push(`  [${label}] 新增 ${d.added.length} 项 / 删除 ${d.removed.length} 项`);
    for (const k of cap(d.added, max, (x) => `+ ${entryLabel(x)}`)) lines.push(`      ${k}`);
    for (const k of cap(d.removed, max, (x) => `- ${entryLabel(x)}`)) lines.push(`      ${k}`);
  }

  const dup = [...(diff.duplicates?.old || []), ...(diff.duplicates?.new || [])];
  if (dup.length) {
    lines.push(
      `  [注意] lockfile 里出现重复段落：${[...new Set(dup)].join(" / ")} —— ` +
        `常见于合并冲突或 install 被中断，建议删除 lockfile 后重新 pnpm install 生成。`
    );
  }

  return lines;
}

/** 把「安装时 lockfile」与「仓库 lockfile」的差异渲染成用户可读的多行文本。 */
export function renderDriftReport(diff, opts = {}) {
  const lines = [];
  lines.push("依赖与 lockfile 不一致，差异如下（仓库 pnpm-lock.yaml 与最近一次安装时的 lockfile 对比）：");
  lines.push("");
  const body = renderLockDiff(diff, opts);
  if (!body.length) {
    lines.push("  两份 lockfile 的实质内容一致（差异仅在注释/空行/条目顺序）。");
    lines.push("  若仍被判为不一致，可在项目根执行 pnpm install 让两者对齐。");
    return lines;
  }
  return lines.concat(body);
}
