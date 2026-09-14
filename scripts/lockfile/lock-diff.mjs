/**
 * lock-diff.mjs — pnpm-lock.yaml 差异定位（「依赖哪里不一致」的可读答案）
 *
 * 解决 ISSUE #550：run-local.ps1 / quality-gate.ps1 只比对两个 lockfile 的
 * SHA256，只能回答「不一致」，回答不了「哪里不一致」。本模块解析两份 pnpm
 * lockfile（v9 YAML，只取顶层段落，不做通用 YAML 解析），按段落给出可读差异：
 *
 *   [1] 顶层配置   settings / overrides 等
 *   [2] 直接依赖   各 importer 的 dependencies（specifier 与解析版本）
 *   [3] 解析结果   packages / snapshots 的条目增删
 *
 * 只依赖 Node 内置能力（无 yaml 依赖，standalone 产物里也不带第三方解析器）。
 * 命令行入口（tools/start/run-local.ps1 与 scripts/quality-gate.ps1 都经它输出）：
 *
 *   node scripts/lockfile/lock-diff.mjs --installed <path> --root <path> [--max-per-section N]
 */
import fs from "node:fs";

/**
 * @typedef {Object} DepEntry 解析后的依赖项
 * @property {string} specifier package.json 里的声明（如 `^16.3.2`）
 * @property {string} version 实际解析到的版本（含 peer 依赖尾巴）
 */

/**
 * @typedef {Object} LockSection 一个顶层段落
 * @property {Map<string, string[]>} keys 一级键 → 该键下的原始行（扁平段为空表）
 * @property {string[]} raw 整段原始行（扁平段直接读这里）
 */

/**
 * @typedef {Object} ParsedLockfile 规范化后的 lockfile
 * @property {Map<string, LockSection>} sections 段落名 → 段落
 * @property {Map<string, Map<string, Map<string, DepEntry>>>} importer importer → 依赖组 → 依赖表
 * @property {string[]} duplicates 出现多次的段落名
 * @property {string} lockfileVersion
 */

/**
 * @typedef {Object} FieldChange 扁平表里的一项变更
 * @property {string} key
 * @property {string} [value] 新增/删除项的值
 * @property {string} [from] 变更前的值
 * @property {string} [to] 变更后的值
 */

/**
 * @typedef {Object} DepChange 依赖表里的一项变更
 * @property {string} name
 * @property {DepEntry|undefined} [value] 新增/删除项
 * @property {string} [specifier] 当前的 specifier
 * @property {string} [fromSpecifier] 变更前的 specifier
 * @property {string} [from] 变更前的解析版本
 * @property {string} [to] 变更后的解析版本
 */

/**
 * @typedef {Object} FlatDiff 扁平表差异
 * @property {FieldChange[]} added
 * @property {FieldChange[]} removed
 * @property {FieldChange[]} changed
 */

/**
 * @typedef {Object} GroupDiff 一组依赖表的差异
 * @property {DepChange[]} added
 * @property {DepChange[]} removed
 * @property {DepChange[]} changed
 */

/**
 * @typedef {Object} EntryDiff 条目级（packages/snapshots）差异：只有键的增删
 * @property {string[]} added
 * @property {string[]} removed
 */

/**
 * @typedef {Object} LockDiff diffLockfiles 的返回值
 * @property {string} lockfileVersion 版本串有变化时形如 `9.0 -> 9.1`，否则空串
 * @property {{old: string[], new: string[]}} duplicates 两份文件里各自的重复段落
 * @property {FlatDiff} settings
 * @property {FlatDiff} overrides
 * @property {Record<string, Record<string, GroupDiff>>} importers importer → 依赖组 → 差异
 * @property {EntryDiff} packages
 * @property {EntryDiff} snapshots
 */

/**
 * 去掉 lockfile 头部的「pnpm 自举（bundled CLI）」段。
 *
 * 仓库里的 `pnpm-lock.yaml` 头部可能带一段描述 pnpm 自身的 `importers/packages/snapshots`
 * 内容，末尾用一行 `---` 与真正的依赖内容分隔（本仓库实测有）。它**不是依赖差异**，
 * 但形态与正文完全一样：不过滤的话，任何一个只有正文的 lockfile（例如
 * `node_modules\.pnpm\lock.yaml`）与它比对都会得出「packages 新增 15 项、snapshots
 * 删除 1248 项」——哈希明明相等（门禁判定「一致」），差异报告却说天翻地覆。
 *
 * 判据是**最后一行** `---`：只认文档末尾之前的那一条分隔线，正文里出现同名行
 * 不受影响。
 */
export function stripBundledSection(text) {
  const marker = "\n---\n";
  const i = text.lastIndexOf(marker);
  return i >= 0 ? text.slice(i + marker.length) : text;
}

/** 顶层段落标记：只有行首、无缩进的 `key:` 才算段落起点。 */
const SECTION_RE = /^([A-Za-z][A-Za-z0-9_-]*):\s*$/;

/**
 * 把 lockfile 文本切成顶层段落 → 行数组。
 * 重复段落（同一文件里出现两次）会追加合并，调用方据 duplicates 自行提示。
 */
export function splitTopSections(text) {
  const sections = new Map();
  const duplicates = [];
  let current = null;
  for (const line of stripBundledSection(text).split(/\r?\n/)) {
    const m = SECTION_RE.exec(line);
    if (m) {
      const name = m[1];
      if (sections.has(name)) {
        if (!duplicates.includes(name)) duplicates.push(name);
        current = sections.get(name); // 合并到既有段落，避免后写的覆盖先写的
        continue;
      }
      current = [];
      sections.set(name, current);
      continue;
    }
    if (current) current.push(line);
  }
  return { sections, duplicates };
}

/** 缩进（空格数）；制表符按 2 空格折算，避免脏文件把层级算错。 */
function indentOf(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

/** 去掉成对引号。 */
function unquote(s) {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

/** 段落体的一级键（YAML 键，可被引号包裹，如 `'@pnpm/exe.win32-x64@12.4.1'`）。 */
const KEY_RE = /^(["']?)([^:'"]*\S)\1:\s*(.*)$/;

/**
 * 段落缓冲区 → 一级键 → 行数组。
 * 段落体形如：
 *   settings:
 *
 *     autoInstallPeers: true
 *   或
 *   packages:
 *
 *     '@adobe/css-tools@4.5.0':
 *       resolution: ...
 *   一级键 = 段落内缩进最小的键行。不依赖固定缩进宽度（pnpm 的缩进随层级变化）。
 */
export function splitTopKeys(lines) {
  const entries = new Map();
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = KEY_RE.exec(line.trim());
    if (!m) continue;
    minIndent = Math.min(minIndent, indentOf(line));
  }
  if (minIndent === Infinity) return entries;
  let cur = null;
  for (const line of lines) {
    if (!line.trim()) {
      if (cur) entries.get(cur).push(line);
      continue;
    }
    const ind = indentOf(line);
    if (ind === minIndent) {
      const m = KEY_RE.exec(line.trim());
      const name = unquote(m ? m[2] : line.trim());
      if (!entries.has(name)) entries.set(name, []);
      cur = name;
      continue;
    }
    if (cur) entries.get(cur).push(line);
  }
  return entries;
}

/**
 * 段落原文行 → 键值表（去引号、trim）。用于 settings / overrides 这类扁平表：
 * 它们的「键: 值」与段落同缩进、没有子行，splitTopKeys 拿到的是空数组，
 * 必须直接读原文行。`val` 为空的行是块头（如 `importers:` 下的 `.:`），跳过。
 */
export function flatEntries(lines) {
  const out = new Map();
  for (const line of lines) {
    const m = /^\s*([^\s:#][^:]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = unquote(m[1].trim());
    const val = m[2];
    if (!val) continue; // 「键:」后面跟子块（如 importers 的 .:），不是扁平表
    out.set(key, unquote(val));
  }
  return out;
}

/** importers 段的某个 importer（如 `.`）→ { dependencies, devDependencies, ... } → 行数组 */
export function importerGroups(lines) {
  return splitTopKeys(lines);
}

/** 依赖表行数组 → Map<包名, { specifier, version }> */
export function parseDependencyTable(lines) {
  const out = new Map();
  // 包名行是表内缩进最小的一行（pnpm 的缩进宽度随层级变化，不能写死 4/6 空格）
  let nameIndent = Infinity;
  for (const line of lines) {
    const body = line.trim();
    if (!body || !body.endsWith(":")) continue;
    nameIndent = Math.min(nameIndent, indentOf(line));
  }
  let name = null;
  for (const line of lines) {
    const ind = indentOf(line);
    const body = line.trim();
    if (!body) continue;
    if (ind === nameIndent) {
      if (body.endsWith(":")) {
        name = unquote(body.slice(0, -1));
        out.set(name, { specifier: "", version: "" });
      } else {
        // `name: version`（pnpm 简写形态，snapshots 里常见；dependencies 段一般是块形式）
        const idx = body.indexOf(":");
        out.set(unquote(body.slice(0, idx)), { specifier: "", version: unquote(body.slice(idx + 1)) });
        name = null;
      }
      continue;
    }
    if (!name) continue;
    const m = /^(specifier|version):\s*(.*)$/.exec(body);
    if (m) out.get(name)[m[1]] = unquote(m[2]);
  }
  return out;
}

const LOCK_PREFIX = "lockfileVersion";

/**
 * 解析一份 lockfile → 规范化结构。
 * 返回 { importer: Map, sections: Map<段落名, Map<键, 原文行数组>>, raw }
 */
export function parseLockfile(text) {
  const { sections, duplicates } = splitTopSections(text);
  const out = { sections: new Map(), importer: new Map(), duplicates, lockfileVersion: "" };
  for (const [name, lines] of sections) {
    if (name === LOCK_PREFIX) {
      out.lockfileVersion = unquote(lines.find((l) => l.trim()) || "");
      continue;
    }
    // keys 用于条目级比对（packages/snapshots/importers）；
    // raw 保留整段原文，供 settings/overrides 这类扁平表直接读值——
    // 「键: 值」同缩进的扁平段不产生子行，keys 会得到空数组。
    out.sections.set(name, { keys: splitTopKeys(lines), raw: lines });
  }
  const importers = out.sections.get("importers");
  if (importers) {
    for (const [importer, lines] of importers.keys) {
      const groups = new Map();
      for (const [group, body] of importerGroups(lines)) {
        groups.set(group, parseDependencyTable(body));
      }
      out.importer.set(importer, groups);
    }
  }
  return out;
}

/** 段落取一级键表（settings 这类扁平段为空表，改用 .raw）。 */
function sectionKeys(section) {
  return section ? section.keys : new Map();
}

/** 条目指纹：忽略空行与注释，用于判断同一段落里的条目是否真的变了。 */
function fingerprint(lines) {
  return lines
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() && !/^\s*#/.test(l))
    .join("\n");
}

/**
 * 对比两份 lockfile。
 * @returns {{lockfileVersion:string, sectionDiffs:object, importerDiffs:object, packageDiffs:object}}
 */
export function diffLockfiles(oldText, newText) {
  const a = parseLockfile(oldText);
  const b = parseLockfile(newText);
  const result = {
    lockfileVersion: "",
    duplicates: { old: a.duplicates, new: b.duplicates },
    settings: mergeFlatDiff(a.sections.get("settings"), b.sections.get("settings")),
    overrides: mergeFlatDiff(a.sections.get("overrides"), b.sections.get("overrides")),
    importers: diffImporters(a, b),
    packages: { added: [], removed: [] },
    snapshots: { added: [], removed: [] },
  };
  const va = a.lockfileVersion;
  const vb = b.lockfileVersion;
  if (va !== vb) result.lockfileVersion = `${va || "(无)"} → ${vb || "(无)"}`;

  for (const [sectionName, key] of [
    ["packages", "packages"],
    ["snapshots", "snapshots"],
  ]) {
    const sa = sectionKeys(a.sections.get(sectionName));
    const sb = sectionKeys(b.sections.get(sectionName));
    const added = [];
    const removed = [];
    for (const k of sb.keys()) if (!sa.has(k)) added.push(k);
    for (const k of sa.keys()) if (!sb.has(k)) removed.push(k);
    result[key] = { added: added.sort(), removed: removed.sort() };
  }

  result.raw = { old: a, new: b };
  return result;
}

/** settings / overrides 这类扁平表：按值比对。 */
function mergeFlatDiff(oldSection, newSection) {
  const a = oldSection ? flatEntries(oldSection.raw) : new Map();
  const b = newSection ? flatEntries(newSection.raw) : new Map();
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of b) {
    if (!a.has(k)) added.push({ key: k, value: v });
    else if (a.get(k) !== v) changed.push({ key: k, from: a.get(k), to: v });
  }
  for (const [k, v] of a) if (!b.has(k)) removed.push({ key: k, value: v });
  return { added, removed, changed };
}

/** 各 importer 的依赖表逐项比对。 */
function diffImporters(a, b) {
  const names = [...new Set([...a.importer.keys(), ...b.importer.keys()])].sort();
  const out = {};
  for (const name of names) {
    const ga = a.importer.get(name) || new Map();
    const gb = b.importer.get(name) || new Map();
    const groups = {};
    for (const group of [...new Set([...ga.keys(), ...gb.keys()])].sort()) {
      const da = ga.get(group) || new Map();
      const db = gb.get(group) || new Map();
      const added = [];
      const removed = [];
      const changed = [];
      for (const [pkg, val] of db) {
        if (!da.has(pkg)) added.push({ name: pkg, value: val });
        else {
          const old = da.get(pkg);
          if (old.version !== val.version || old.specifier !== val.specifier) {
            changed.push({ name: pkg, specifier: val.specifier, from: old.version, to: val.version, fromSpecifier: old.specifier });
          }
        }
      }
      for (const [pkg, val] of da) if (!db.has(pkg)) removed.push({ name: pkg, value: val });
      if (added.length || removed.length || changed.length) groups[group] = { added, removed, changed };
    }
    if (Object.keys(groups).length) out[name] = groups;
  }
  return out;
}

/** diff 是否为空（两份 lockfile 实质一致）。 */
export function isEmptyDiff(d) {
  return (
    !d.lockfileVersion &&
    !d.settings.added.length &&
    !d.settings.removed.length &&
    !d.settings.changed.length &&
    !d.overrides.added.length &&
    !d.overrides.removed.length &&
    !d.overrides.changed.length &&
    Object.keys(d.importers).length === 0 &&
    !d.packages.added.length &&
    !d.packages.removed.length &&
    !d.snapshots.added.length &&
    !d.snapshots.removed.length
  );
}

/** 段落行数组的一致指纹（导出供守卫用：判断 packages/snapshots 是否只有顺序差异）。 */
export function sectionFingerprint(sectionLines) {
  return fingerprint(sectionLines);
}
