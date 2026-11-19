/* ── ComfyUI 源码 ↔ 运行环境依赖脱节检测（ISSUE #4192）──────────────────
 *
 * 现场：实例的 ComfyUI 源码升到 v0.45.2，而运行环境（ComfyUI/.venv）里的
 * comfy-aimdo 还是 0.5.6 —— 节点执行期才爆出
 * `ModelVBAR.__init__() got an unexpected keyword argument 'pageout_callback'`，
 * 用户视角是「工作流/节点坏了」，实际根因是「源码升了、依赖没跟上」。
 *
 * 本模块在拉起 ComfyUI 之前做一次**只读核对**：读源码根 requirements.txt 里
 * 带 `==` 精确锁定的条目，对照所选解释器 site-packages 里 dist-info 的实际
 * 版本，把落后/缺失的差异面提前点名。只预警、不阻断——frontend/templates
 * 这类漂移不该拦住启动，判「能不能拉起」仍是既有链路的事。
 *
 * §18.4 三选一：与 launch-path.ts 同族走第三类（纯 Node 宿主），只有
 * node:fs / node:path 的只读读取，登记在 tests/lib-node-only-declarations.test.ts
 * 的 PURE_NODE_HOSTS。文件读取全部收敛在 io 注入点上，纯解析/比对函数直接
 * 吃字符串与 Map，可被单测逐条锁住（见 dep-drift.test.ts）。
 */
import fs from "node:fs";
import path from "node:path";

import { sitePackagesDirsForInterpreter } from "./launch-path";

/** requirements.txt 里一条 `==` 精确锁定（name 已规范化，version 为纯版本串）。 */
export type PinnedRequirement = {
  name: string;
  version: string;
};

/** 一处脱节：required 来自 requirements.txt，installed 为 null 表示环境里没有。 */
export type ComfyDepDrift = {
  installed: string | null;
  name: string;
  required: string;
};

/** 一次核对的总报告：版本读不到时 comfyuiVersion 为 null（不影响差异判定）。 */
export type ComfyDepDriftReport = {
  comfyuiVersion: string | null;
  drift: Array<ComfyDepDrift>;
  requirementsPath: string;
};

/** 文件系统读取面：全部收敛成可注入的两个函数（与 launch-path 注入 exists 同思路）。 */
export type DepDriftIo = {
  exists: (p: string) => boolean;
  readDirNames: (p: string) => Array<string>;
  readFile: (p: string) => string;
};

const defaultIo: DepDriftIo = {
  exists: (p) => fs.existsSync(/*turbopackIgnore: true*/ p),
  readDirNames: (p) => fs.readdirSync(/*turbopackIgnore: true*/ p),
  readFile: (p) => fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8"),
};

/** 包名规范化（PEP 503）：小写、连续的 `-`/`_`/`.` 折叠成单个 `-`。
 *  requirements.txt 写 `comfy_aimdo`、dist-info 写 `comfy-aimdo` 必须判成同名。 */
export function normalizePkgName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[-_.]+/g, "-");
}

/**
 * 解析 requirements.txt 里带 `==` 精确锁定的条目。
 *
 * 刻意只认 `==`：区间（`>=` / `~=`）与未锁定的裸包名本就允许漂移，拿它们
 * 对比只会制造误报；真正的「锁包」才是源码升级后必须跟上的那批。行内环境
 * 标记（`; python_version < "3.12"`）、extras（`pkg[extra]==1.0`）、整行与
 * 行内注释、空行、`--` 开头的选项行都跳过。
 */
export function parsePinnedRequirements(content: string): Array<PinnedRequirement> {
  const out: Array<PinnedRequirement> = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (line === "" || line.startsWith("-")) {
      continue;
    }
    const withoutMarker = line.split(";")[0]?.trim() ?? "";
    const m =
      /^(?<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*(?<version>[^;\s]+)$/.exec(
        withoutMarker,
      );
    if (m?.groups === undefined) {
      continue;
    }
    const pinnedName = m.groups.name;
    const pinnedVersion = m.groups.version;
    if (pinnedName === undefined || pinnedVersion === undefined) {
      continue;
    }
    out.push({ name: normalizePkgName(pinnedName), version: pinnedVersion.trim() });
  }
  return out;
}

/**
 * 扫一个 site-packages 目录里所有 `*.dist-info/METADATA` 的 Name/Version。
 *
 * 只认 dist-info（pip ≥ 20 的标准形态，本仓面对的 venv / standalone-env /
 * python_embeded 都由 uv / pip 装出）；读不到的条目跳过，不抛错——核对是
 * 尽力而为的预警，环境怪异时宁可少报也不把启动带崩。
 */
export function readInstalledVersions(
  sitePackagesDir: string,
  io: DepDriftIo = defaultIo,
): Map<string, string> {
  const out = new Map<string, string>();
  let entries: Array<string>;
  try {
    entries = io.readDirNames(sitePackagesDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".dist-info")) {
      continue;
    }
    let meta: string;
    try {
      meta = io.readFile(path.join(sitePackagesDir, entry, "METADATA"));
    } catch {
      continue;
    }
    const name = /^Name:\s*(?<value>.+)$/m.exec(meta)?.groups?.value?.trim();
    const version = /^Version:\s*(?<value>.+)$/m.exec(meta)?.groups?.value?.trim();
    if (name !== undefined && name !== "" && version !== undefined && version !== "") {
      out.set(normalizePkgName(name), version);
    }
  }
  return out;
}

/**
 * 锁包 ↔ 实际版本的差异面：版本不一致或环境里没有都算脱节。
 * 版本按字符串精确比（锁包本来就是精确等值约束，不需要 semver 语义）。
 */
export function findDepDrift(
  pinned: Array<PinnedRequirement>,
  installed: Map<string, string>,
): Array<ComfyDepDrift> {
  const out: Array<ComfyDepDrift> = [];
  for (const req of pinned) {
    const have = installed.get(req.name);
    if (have === undefined || have !== req.version) {
      out.push({ name: req.name, required: req.version, installed: have ?? null });
    }
  }
  return out;
}

/** 从源码根的 comfyui_version.py 里尽力读 `__version__`（读不到给 null）。 */
function readComfyuiVersion(sourceRoot: string, io: DepDriftIo): string | null {
  try {
    const content = io.readFile(path.join(sourceRoot, "comfyui_version.py"));
    return /__version__\s*=\s*["'](?<version>[^"']+)["']/.exec(content)?.groups?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * 组装用户可行动的预警文案。点名 ComfyUI 版本、逐个列差异、给修法。
 * 差异条目数不设硬上限的场景不存在（requirements 的 `==` 锁包就十几条），
 * 但仍按行拼接，保证每条差异一行、日志里可 grep。
 */
export function buildDepDriftWarning(report: ComfyDepDriftReport): string {
  const lines = report.drift.map((d) => {
    const have = d.installed ?? "未安装";
    return `${d.name} 需要 ${d.required}、实际 ${have}`;
  });
  const version = report.comfyuiVersion === null ? "（版本未知）" : `v${report.comfyuiVersion}`;
  return (
    `警告：ComfyUI 源码（${version}）与运行环境依赖不一致（源码已升级、环境依赖未跟上）——` +
    `${lines.join("；")}。节点执行可能报出难懂的 Python 错误（如 ` +
    `ModelVBAR ... unexpected keyword argument 'pageout_callback'）。` +
    `建议为该环境补齐依赖后重启 ComfyUI：python -m pip install -r ${report.requirementsPath}。` +
    `若本机访问 PyPI 缓慢，可加国内镜像：-i https://pypi.tuna.tsinghua.edu.cn/simple`
  );
}

/**
 * 核对入口：源码根 + 所选解释器 → 差异报告。
 *
 * 任何一步拿不到事实（没有 requirements.txt、解释器环境里找不到
 * site-packages、读取失败）都返回 null，表示「无从核对」——caller 不预警。
 * 返回报告时 `drift` 为空数组即「锁包全部对上」。
 */
export function checkComfyDepDrift(
  sourceRoot: string,
  pythonCmd: string,
  io: DepDriftIo = defaultIo,
): ComfyDepDriftReport | null {
  try {
    const requirementsPath = path.join(sourceRoot, "requirements.txt");
    if (!io.exists(requirementsPath)) {
      return null;
    }
    const pinned = parsePinnedRequirements(io.readFile(requirementsPath));
    if (pinned.length === 0) {
      return null;
    }
    const installed = new Map<string, string>();
    for (const sp of sitePackagesDirsForInterpreter(pythonCmd, io.exists)) {
      for (const [name, version] of readInstalledVersions(sp, io)) {
        // 多个 site-packages 都有同名包时以后写的为准——与解释器的解析顺序
        // 无强关联，但核对只关心「装没装对」，任一份在案即可。
        installed.set(name, version);
      }
    }
    if (installed.size === 0) {
      return null;
    }
    return {
      comfyuiVersion: readComfyuiVersion(sourceRoot, io),
      drift: findDepDrift(pinned, installed),
      requirementsPath,
    };
  } catch {
    // 预警通道绝不把启动带崩（与 §5「诊断通道不得把生成带崩」同一纪律）。
    return null;
  }
}
