#!/usr/bin/env node
/**
 * 开发盘调优的**判据层**：由探测读数算出动作矩阵（每条杠杆一个状态 + 后果 + 可复制的动作）。
 *
 * 与入口层的分工：入口层（`scripts/dev-drive-tune.mjs`）负责命令行、报告渲染与落盘；
 * 本文件只负责「读数 → 结论」这一段纯逻辑 —— 不碰命令行、不写文件，
 * 于是契约测试可以逐条定点覆盖某一档判定，而不用起子进程。
 *
 * 拆分的理由是硬闸：`scripts/**` 里超 900 行的文件直接阻断（规范 §12.6 R5），
 * 而「判据」与「入口」本来就是两件事 —— 混在一处时，加一条杠杆就得动入口文件。
 */
import path from "node:path";

import {
  compareTargets,
  formatThroughput,
  thirdPartyEngineUsage,
} from "./dev-drive-bench.mjs";

/**
 * @typedef {import("./dev-drive-probe.mjs").ProbeReport} ProbeReport
 * @typedef {import("./dev-drive-probe.mjs").CacheEntry} CacheEntry
 * @typedef {import("./dev-drive-probe.mjs").VolumeProbe} VolumeProbe
 * @typedef {import("./dev-drive-probe.mjs").WorkdirEntry} WorkdirEntry
 * @typedef {import("./dev-drive-probe.mjs").IndexMarking} IndexMarking
 * @typedef {import("./dev-drive-bench.mjs").BenchReport} BenchReport
 */

/**
 * @typedef {"ok" | "actionable" | "blocked" | "na"} LeverStatus
 *   ok         已经就位，不动它；
 *   actionable 一条命令 / 一个配置项就能吃到红利；
 *   blocked    需要管理员权限、或需要重格式化卷（判定权在人）；
 *   na         与本仓这条链路无关。
 */

/**
 * @typedef {object} LeverAction
 * @property {string} label 给人看的一句话（这条动作为什么要做）
 * @property {string} command 可直接复制的命令
 * @property {"admin" | "user" | "repo"} scope 谁来做（管理员 / 用户 / 仓库级）
 */

/**
 * @typedef {object} Lever
 * @property {string} id
 * @property {string} title
 * @property {LeverStatus} status
 * @property {string} detail 判据与后果（这一条为什么是这个状态）
 * @property {LeverAction[]} actions
 */

/**
 * @typedef {object} LeverSummary
 * @property {number} ok
 * @property {number} actionable
 * @property {number} blocked
 * @property {number} na
 * @property {number} total
 */

/**
 * 探测结果 + 派生出来的动作矩阵（报告的完整形状）。
 * @typedef {ProbeReport & { levers?: Lever[], summary?: LeverSummary, bench?: BenchReport | null }} DevDriveReport
 */

/**
 * 由探测结果算出动作矩阵。
 *
 * 状态口径（四档，报告与 `--check` 退出码都读它）：
 *   ok         已经就位，不动它；
 *   actionable 一条命令 / 一个配置项就能吃到红利；
 *   blocked    需要管理员权限、或需要重格式化卷（判定权在人）；
 *   na         与本仓这条链路无关（例如非 ReFS 上的块克隆）。
 *
 * @param {DevDriveReport} report 探测结果
 * @returns {Lever[]}
 */
export function buildLevers(report) {
  const levers = [];
  const volume = report.volume ?? {};
  const caps = report.capabilities ?? {};
  const pnpm = report.pnpm ?? {};
  const git = report.git ?? {};
  const cache = report.cache ?? {};
  const drive = volume.root ?? "";

  levers.push(pnpmStoreLever(pnpm, report.repo));
  levers.push(workdirLever(report.workdirs ?? []));
  levers.push(blockCloneLever(volume, caps, drive));
  levers.push(defenderLever(volume, report.defender ?? { known: false }));
  levers.push(filtersLever(volume, report.bench ?? null));
  if (report.bench && report.bench.ran) levers.push(ioBenchLever(report.bench));
  levers.push(searchIndexLever(drive, report.indexMarking ?? { known: false, sampled: 0, marked: 0, ratio: null }));
  levers.push(gitIndexLever(git));
  levers.push(cacheLever("temp", "构建期临时目录（TEMP / TMP）", cache.temp, drive));
  levers.push(cacheLever("cargo-home", "Rust 依赖缓存（CARGO_HOME）", cache.cargoHome, drive));
  levers.push(
    cacheLever("playwright", "Playwright 浏览器（PLAYWRIGHT_BROWSERS_PATH）", cache.playwright, drive),
  );
  levers.push(cacheLever("npm-cache", "npm 缓存（npm_config_cache）", cache.npmCache, drive));
  levers.push(sparseLever(caps));
  levers.push(sqliteLever());

  return levers;
}

/**
 * 动作矩阵的计数（报告尾行与 `--check` 退出码都读它）。
 * @param {Lever[]} levers
 * @returns {LeverSummary}
 */
export function summarizeLevers(levers) {
  /** @type {LeverSummary} */
  const summary = { ok: 0, actionable: 0, blocked: 0, na: 0, total: levers.length };
  for (const lever of levers) {
    if (lever.status in summary) summary[lever.status] += 1;
  }
  return summary;
}

/* ------------------------------------------------------------------ *
 * 动作矩阵的各条（每个一条，单独一个函数，便于单测定点覆盖）
 * ------------------------------------------------------------------ */

/**
 * pnpm store 与检出同卷 → 硬链接零拷贝（ReFS 的第一份红利）。
 * @param {ProbeReport["pnpm"]} pnpm
 * @param {string} repo
 * @returns {Lever}
 */
function pnpmStoreLever(pnpm, repo) {
  const storePath = pnpm.storePath ?? "";
  if (!storePath) {
    return {
      id: "pnpm-store",
      title: "pnpm store 与检出同卷（硬链接零拷贝）",
      status: "na",
      detail: "没读到 pnpm store 位置（`pnpm store path` 不可用），本条不判。",
      actions: [],
    };
  }
  if (pnpm.sameVolume) {
    return {
      id: "pnpm-store",
      title: "pnpm store 与检出同卷（硬链接零拷贝）",
      status: "ok",
      detail: `store 在 ${storePath}，与检出同卷 → node_modules 走硬链接，装依赖不再复制字节。`,
      actions: [],
    };
  }
  return {
    id: "pnpm-store",
    title: "pnpm store 与检出同卷（硬链接零拷贝）",
    status: "actionable",
    detail:
      `store 在 ${storePath}，与检出（${repo}）**不同卷** → 每次装依赖都要把整份字节复制过去，` +
      "这是 pnpm 侧最大的一笔冤枉 I/O。",
    actions: [
      {
        label: "把 store 指到检出所在卷",
        command: `pnpm config set store-dir ${path.dirname(path.dirname(storePath))}`,
        scope: "user",
      },
    ],
  };
}

/**
 * 构建与依赖目录的真实落点（解开软链接后再判卷）。
 * @param {WorkdirEntry[]} workdirs
 * @returns {Lever}
 */
function workdirLever(workdirs) {
  const present = workdirs.filter((entry) => entry.exists);
  if (present.length === 0) {
    return {
      id: "workdir",
      title: "构建与依赖目录的真实落点（软链接要解开再判）",
      status: "na",
      detail: "检出里还没有这些目录（没装依赖 / 没构建过），本条不判。",
      actions: [],
    };
  }
  const offVolume = present.filter((entry) => !entry.sameVolume);
  if (offVolume.length === 0) {
    return {
      id: "workdir",
      title: "构建与依赖目录的真实落点（软链接要解开再判）",
      status: "ok",
      detail:
        `${present.map((entry) => entry.name).join("、")} 的真实路径都在开发盘上` +
        " → 依赖物化、构建产物与 git 对象读写都吃得到这块盘。",
      actions: [],
    };
  }
  return {
    id: "workdir",
    title: "构建与依赖目录的真实落点（软链接要解开再判）",
    status: "actionable",
    detail:
      `这些目录的真实路径不在开发盘上：${offVolume
        .map((entry) => `${entry.name} → ${entry.realPath}`)
        .join("；")} → 它们每次读写都要跨卷。`,
    actions: [
      {
        label: "把链接指向开发盘上的目录（或删掉软链接直接放在检出里）",
        command: "（人工决定：软链接的终点要自己挑，改完重新装依赖 / 重新构建）",
        scope: "user",
      },
    ],
  };
}

/**
 * 块克隆：判据是「复制之后源与目标是不是同一批物理簇」，不是「强制克隆标志能不能用」。
 * @param {VolumeProbe} volume
 * @param {ProbeReport["capabilities"]} caps
 * @param {string} drive
 * @returns {Lever}
 */
function blockCloneLever(volume, caps, drive) {
  if (volume.category !== "refs") {
    return {
      id: "block-clone",
      title: "块克隆（复制大文件不搬字节）",
      status: "na",
      detail: "块克隆是 ReFS 专属能力，当前卷不是 ReFS，本条不适用。",
      actions: [],
    };
  }
  if (!caps.blockCloneKnown) {
    return {
      id: "block-clone",
      title: "块克隆（复制大文件不搬字节）",
      status: "na",
      detail:
        "读不到物理簇信息（`fsutil file queryextents` 不可用），本条不判 —— " +
        "读不到就不猜，是这份工具的底线。",
      actions: [],
    };
  }
  if (caps.blockClone) {
    /** @type {LeverAction[]} */
    const actions = [];
    if (!caps.libuvForceClone) {
      actions.push({
        label: "别把 pnpm 的导入方式设成 clone（强制克隆标志在 Windows 上没有实现）",
        command: "（不用改：pnpm 默认的硬链接比克隆更省空间，且本仓 store 已与检出同卷）",
        scope: "user",
      });
    }
    return {
      id: "block-clone",
      title: "块克隆（复制大文件不搬字节）",
      status: "ok",
      detail:
        "实测：复制一份 4 MB 文件后，源与目标落在**同一批物理簇**（LCN 相同）→ " +
        "这块卷的复制是元数据级操作，不搬字节。Windows 11 24H2 起受支持的复制操作原生克隆，" +
        "开发盘上尤其明显：构建产物拷贝、依赖物化、文件同步都省掉了整份字节的读写。",
      actions,
    };
  }
  /** @type {LeverAction[]} */
  const actions = [];
  if (volume.devDrive !== "yes") {
    actions.push({
      label: "把该卷按 Dev Drive 格式化（破坏性：会清空该卷，先备份）",
      command: `Format-Volume -DriveLetter ${drive.replace(/[:\\]/g, "")} -DevDrive`,
      scope: "admin",
    });
  }
  return {
    id: "block-clone",
    title: "块克隆（复制大文件不搬字节）",
    status: "blocked",
    detail:
      "实测：复制之后源与目标的物理簇不同 → 这块卷的复制是真实字节拷贝。" +
      "ReFS 自 Windows Server 2016 起具备块克隆能力，客户端 Windows 从 24H2 起的受支持复制操作会原生克隆；" +
      "没生效通常是「这块卷没有被指定为开发驱动器」或系统版本未开放这一条。",
    actions,
  };
}

/**
 * Defender 实时保护：开发盘上最大的隐性开销；受信任的开发驱动器走性能模式。
 * @param {VolumeProbe} volume
 * @param {ProbeReport["defender"]} defender
 * @returns {Lever}
 */
function defenderLever(volume, defender) {
  const drive = volume.root ?? "";
  if (!drive) {
    return {
      id: "defender",
      title: "Defender 实时保护（扫描每个新写入的文件）",
      status: "na",
      detail: "没读到卷信息，本条不判。",
      actions: [],
    };
  }
  if (!defender.known) {
    return {
      id: "defender",
      title: "Defender 实时保护（扫描每个新写入的文件）",
      status: "na",
      detail: "读不到 Defender 策略（多半是权限不足），本条不判。",
      actions: [],
    };
  }
  if (volume.devDrive === "yes") {
    if (/受信任/.test(volume.devDriveLabel ?? "")) {
      return {
        id: "defender",
        title: "Defender 实时保护（扫描每个新写入的文件）",
        status: "ok",
        detail: "该卷是**受信任的开发驱动器** → Defender 走性能模式（异步扫描），不逐文件拦。",
        actions: [],
      };
    }
    return {
      id: "defender",
      title: "Defender 实时保护（扫描每个新写入的文件）",
      status: "actionable",
      detail:
        "该卷是开发驱动器但**未标信任** → Defender 按实时保护全量扫它。" +
        "标成受信任即走性能模式（管理员）。",
      actions: [
        {
          label: "把这块卷标为受信任（管理员）",
          command: `fsutil devdrv trust ${drive.replace(/[:\\]/g, "")}:`,
          scope: "admin",
        },
      ],
    };
  }
  if (volume.devDrive === "unknown") {
    return {
      id: "defender",
      title: "Defender 实时保护（扫描每个新写入的文件）",
      status: "na",
      detail:
        `实测：Defender 实时保护${defender.realTime ? "开着" : "关着"}；` +
        "但**这块卷的开发驱动器指定与信任状态查不到**（`fsutil devdrv query` 需要管理员），" +
        "而它恰恰决定 Defender 走不走性能模式 —— 这一条判不了，不猜。" +
        "（若管理员查出来是「受信任」，性能模式就已生效，**不需要**再加排除项。）",
      actions: [
        {
          label: "用管理员查一下信任状态（只读）",
          command: `fsutil devdrv query ${drive.replace(/[:\\]/g, "")}:`,
          scope: "admin",
        },
      ],
    };
  }
  if (defender.exclusions.some((item) => item.toUpperCase() === drive.toUpperCase())) {
    return {
      id: "defender",
      title: "Defender 实时保护（扫描每个新写入的文件）",
      status: "ok",
      detail: `该卷已在 Defender 排除项里（${drive}）→ 写入不再逐文件扫描。`,
      actions: [],
    };
  }
  return {
    id: "defender",
    title: "Defender 实时保护（扫描每个新写入的文件）",
    status: defender.realTime ? "blocked" : "na",
    detail:
      `实测：Defender 实时保护${defender.realTime ? "开着" : "关着"}，该卷不是开发驱动器、也没有排除项` +
      " → node_modules / .next / 构建产物每写一个文件都被扫一遍，这是开发循环里最贵的一笔隐形开销。",
    actions: [
      {
        label: "给该卷加 Defender 排除项（管理员）",
        command: `Add-MpPreference -ExclusionPath "${drive}"`,
        scope: "admin",
      },
    ],
  };
}

/**
 * 开发卷上挂的文件系统筛选器：谁**能看见**这块卷上的文件，以及它有没有在拖慢 I/O。
 *
 * 判据分两件事，不混：
 *   ① **能看见**（安全面）：卷上挂了哪个筛选器，这是机器状态，读得到就是事实；
 *   ② **在拖慢 I/O**（性能面）：Defender 的性能模式**只对 Defender 生效**，
 *      第三方端点防护挂在开发卷上并不吃那一套 —— 但「它挂着」**推不出**「它在扫」。
 *      这一条只能靠负载下的 CPU 归因（`--bench`）才说得清，所以：
 *      没实测 → 记「不判」并给出复测命令；实测到它没干活 → 明说它没在扫；
 *      实测到它在扫 → 才给「改安全策略」那两条路（都是不可逆取舍，判定权在人）。
 * @param {VolumeProbe} volume
 * @param {BenchReport | null} bench
 * @returns {Lever}
 */
function filtersLever(volume, bench) {
  if (!volume.filtersKnown) {
    return {
      id: "dev-drive-filters",
      title: "开发卷上挂的文件系统筛选器（谁能看见这块卷上的文件）",
      status: "na",
      detail:
        "读不到筛选器清单（`fsutil devdrv query` 需要管理员），本条不判。",
      actions: [],
    };
  }
  const thirdParty = volume.filters.filter((name) => name.toLowerCase() !== "wdfilter");
  if (thirdParty.length === 0) {
    return {
      id: "dev-drive-filters",
      title: "开发卷上挂的文件系统筛选器（谁能看见这块卷上的文件）",
      status: "ok",
      detail:
        `只挂了 Defender（${volume.filters.join("、")}）→ Defender 的性能模式覆盖到整块卷，没有第三方扫描源。`,
      actions: [],
    };
  }
  const usage = thirdPartyEngineUsage(bench, thirdParty);
  if (usage.state === "busy") {
    return {
      id: "dev-drive-filters",
      title: "开发卷上挂的文件系统筛选器（谁能看见这块卷上的文件）",
      status: "actionable",
      detail:
        `除了 Defender，还挂了第三方筛选器：${thirdParty.join("、")}。` +
        `实测：负载窗口内它的引擎（${usage.label} / ${usage.process}）消耗了 ${usage.seconds} 秒 CPU` +
        " → 它确实在扫，是真开销。Defender 的性能模式对第三方端点防护不生效，" +
        "所以这一段开销拿不到那套红利。两条路都是安全策略变更，判定权在人：",
      actions: [
        {
          label: "更精准：在那个第三方客户端里把开发卷加进它的排除/信任列表",
          command: "（在联想电脑管家 / Lenovo Windows Security Center 的设置里排除 G:\\）",
          scope: "user",
        },
        {
          label: "更彻底：收窄整台机器的开发卷筛选器策略，只留 Defender（影响所有开发卷）",
          command: "fsutil devdrv setfiltersallowed WdFilter",
          scope: "admin",
        },
      ],
    };
  }
  if (usage.state === "idle") {
    return {
      id: "dev-drive-filters",
      title: "开发卷上挂的文件系统筛选器（谁能看见这块卷上的文件）",
      status: "ok",
      detail:
        `除了 Defender，还挂了第三方筛选器：${thirdParty.join("、")}。` +
        `实测：负载窗口内它的引擎（${usage.label} / ${usage.process}）CPU 增量为 0` +
        " → 它**没有在扫**，不构成性能瓶颈。它只是能看见这块卷上的文件（安全面），" +
        "要不要收窄是安全策略的取舍，不是性能问题 —— 没实测到开销，就别为提速去改安全策略。",
      actions: [],
    };
  }
  if (usage.state === "unknown") {
    return {
      id: "dev-drive-filters",
      title: "开发卷上挂的文件系统筛选器（谁能看见这块卷上的文件）",
      status: "na",
      detail:
        `除了 Defender，还挂了第三方筛选器：${thirdParty.join("、")}。` +
        "它**能看见**这块卷上的文件；但「它有没有在拖慢 I/O」只能靠负载下的实测说话" +
        "（挂着 ≠ 在扫）—— 本轮没跑实测，或认不出它对应哪个引擎进程，所以不判。",
      actions: [
        {
          label: "跑一次 I/O 实测（含 CPU 归因；会真的写几百 MB 数据，跑完即删）",
          command: "pnpm dev:drive --bench",
          scope: "user",
        },
      ],
    };
  }
  return {
    id: "dev-drive-filters",
    title: "开发卷上挂的文件系统筛选器（谁能看见这块卷上的文件）",
    status: "na",
    detail:
      `除了 Defender，还挂了第三方筛选器：${thirdParty.join("、")}。` +
      "「它有没有在拖慢 I/O」只能靠负载下的实测说话（挂着 ≠ 在扫），本轮没跑实测，不判。",
    actions: [
      {
        label: "跑一次 I/O 实测（含 CPU 归因；会真的写几百 MB 数据，跑完即删）",
        command: "pnpm dev:drive --bench",
        scope: "user",
      },
    ],
  };
}

/**
 * I/O 实测：同一段负载在开发卷与参考卷上的表现，以及负载窗口里谁在吃 CPU。
 * @param {BenchReport} bench
 * @returns {Lever}
 */
function ioBenchLever(bench) {
  const dev = bench.targets.find((target) => target.label === "开发卷") ?? null;
  const reference = bench.targets.find((target) => target.label === "参考卷") ?? null;
  const compare = dev ? compareTargets(dev, reference) : null;
  const parts = [];
  for (const target of bench.targets) {
    parts.push(`${target.label}：${formatThroughput(target)}`);
  }
  let verdict = "读数见下。";
  if (compare && compare.comparable) {
    verdict = compare.devFaster
      ? "开发卷在四项上都不慢于参考卷 → 筛选器栈没有形成瓶颈。"
      : "开发卷在某些项上慢于参考卷 → 那几项是真正的开销所在。";
  } else if (bench.note) {
    verdict = bench.note;
  }
  return {
    id: "io-bench",
    title: "I/O 实测（同一段负载在两块卷上的表现 + 谁在吃 CPU）",
    status: "ok",
    detail: `${parts.join("；")}。${verdict}`,
    actions: [],
  };
}

/**
 * Windows Search 索引：后台反复读盘。
 *
 * 这一条要能自己回答「标记到底生效没有」——所以它不只是一条建议，
 * 还读一遍检出里的标记覆盖率：覆盖到位就是「就位」，没到位才给动作。
 * @param {string} drive
 * @param {IndexMarking} marking 抽读到的标记覆盖率
 * @returns {Lever}
 */
function searchIndexLever(drive, marking) {
  if (!drive) {
    return {
      id: "search-index",
      title: "Windows Search 索引（后台读盘）",
      status: "na",
      detail: "没读到卷信息，本条不判。",
      actions: [],
    };
  }
  if (marking && marking.known && marking.ratio !== null && marking.ratio >= 0.95) {
    return {
      id: "search-index",
      title: "Windows Search 索引（后台读盘）",
      status: "ok",
      detail:
        `实测：抽查检出内 ${marking.sampled} 个文件，${marking.marked} 个带「不索引内容」标记` +
        `（${Math.round(marking.ratio * 100)}%）→ 这些内容不再进搜索索引。` +
        "注意：标记只作用于**当前已有**的文件，新落盘的不继承；" +
        "要长期生效，Windows 搜索的「索引选项 → 排除项」里还得加这一条。",
      actions: [],
    };
  }
  return {
    id: "search-index",
    title: "Windows Search 索引（后台读盘）",
    status: "actionable",
    detail:
      "Windows 搜索服务在跑，会持续把开发盘上的内容读进索引；开发目录没有检索价值，" +
      "标成「不索引内容」即可（代价：一次全量属性改写，实测整盘约几分钟；" +
      "标记只作用于当前已有的文件，新落盘的不继承）。",
    actions: [
      {
        label:
          "标记为不索引内容（整盘一条命令：自己枚举、跳过符号链接与联接点，所以不会在 node_modules 里打转）",
        command:
          `$o=[System.IO.EnumerationOptions]::new();$o.RecurseSubdirectories=$true;` +
          `$o.AttributesToSkip=[System.IO.FileAttributes]::ReparsePoint;$o.IgnoreInaccessible=$true;` +
          `foreach($f in [System.IO.Directory]::EnumerateFiles('${drive}\\','*',$o)){` +
          `$a=[System.IO.File]::GetAttributes($f);` +
          `if(-not($a -band [System.IO.FileAttributes]::NotContentIndexed)){` +
          `[System.IO.File]::SetAttributes($f,$a -bor [System.IO.FileAttributes]::NotContentIndexed)}}`,
        scope: "user",
      },
      {
        label:
          "只标某一棵子树时也能用 attrib（注意尾部必须带 \\*，否则它什么也不做）",
        command: `attrib +I /S /D "${drive}\\*"`,
        scope: "user",
      },
    ],
  };
}

/**
 * git 索引与提交图：大量小文件仓的日常瓶颈，仓库级可逆。
 * @param {ProbeReport["git"]} git
 * @returns {Lever}
 */
function gitIndexLever(git) {
  const missing = [];
  if (git.untrackedCache !== "true") missing.push("core.untrackedCache");
  if (Number(git.indexVersion ?? "2") < 4) missing.push("index.version");
  if (git.commitGraph !== "true") missing.push("core.commitGraph");
  if (missing.length === 0) {
    return {
      id: "git-index",
      title: "git 索引格式与提交图（状态查询与历史查询）",
      status: "ok",
      detail: "未跟踪缓存已开、索引已是 v4（路径前缀压缩）、提交图已开 → git 状态与历史查询都走快路径。",
      actions: [],
    };
  }
  return {
    id: "git-index",
    title: "git 索引格式与提交图（状态查询与历史查询）",
    status: "actionable",
    detail:
      `还差：${missing.join("、")} → 这个仓的小文件极多（node_modules 之外，源码与生成物也不少），` +
      "索引 v4 的路径前缀压缩与提交图能把「改一行代码后 git status 要多久」这一项直接压下来。" +
      "配置写在 `.git/config`（仓库级、可逆，不影响其他检出）。",
    actions: [
      {
        label: "落仓库级配置（`pnpm dev:drive --apply` 会替你做）",
        command:
          "git config --local core.untrackedCache true && git config --local index.version 4 && git config --local core.commitGraph true",
        scope: "repo",
      },
    ],
  };
}

/**
 * 缓存目录落点：缓存放在开发盘上，重装/重取都省时间也省系统盘。
 * @param {string} id
 * @param {string} title
 * @param {CacheEntry | null | undefined} entry
 * @param {string} drive
 * @returns {Lever}
 */
function cacheLever(id, title, entry, drive) {
  if (!entry || !entry.path) {
    return {
      id,
      title,
      status: "na",
      detail: "没读到该缓存的当前位置（未设置时用系统默认），本条不判。",
      actions: [],
    };
  }
  if (entry.sameVolume) {
    return {
      id,
      title,
      status: "ok",
      detail: `已落在 ${entry.path}（与检出同卷）→ 读写与清理都在开发盘上。`,
      actions: [],
    };
  }
  return {
    id,
    title,
    status: "actionable",
    detail: `现在在 ${entry.path}（不在开发盘上）→ 走的是系统盘，跨卷读写拿不到开发盘的速度与容量。`,
    actions: [
      {
        label: "指到开发盘（用户级环境变量，改完要重开终端；先建目录）",
        command: `mkdir "${drive}${entry.suggestedSubPath}" && setx ${entry.envName} "${drive}${entry.suggestedSubPath}"`,
        scope: "user",
      },
    ],
  };
}

/**
 * 稀疏文件：主要服务 VHDX 形态的开发盘，本仓这条链路用不上。
 * @param {ProbeReport["capabilities"]} caps
 * @returns {Lever}
 */
function sparseLever(caps) {
  return {
    id: "sparse",
    title: "稀疏文件（大文件只占实际写入的块）",
    status: "na",
    detail:
      caps.sparse
        ? "该卷已启用稀疏文件；本仓没有大体积可变文件，不需要额外动作。"
        : "该卷未启用稀疏文件；它的收益面是 VHDX 形态的开发盘与大体积可变文件，本仓两者都不占，暂不动作。",
    actions: [],
  };
}

/**
 * SQLite 在 ReFS 上的行为：容易被怀疑的一处，给一句实测结论。
 * @returns {Lever}
 */
function sqliteLever() {
  return {
    id: "sqlite-refs",
    title: "SQLite 库文件在 ReFS 上的行为（WAL / 建表 / 读写）",
    status: "ok",
    detail:
      "实测：WAL 模式可开、表可建、读写与检查点都正常 → 应用数据库放在开发盘上没有已知问题。",
    actions: [],
  };
}

