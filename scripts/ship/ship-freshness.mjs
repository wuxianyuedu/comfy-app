/**
 * ship-freshness.mjs —— 依赖新鲜度判据（`check-deps-freshness.mjs --json`）**原值的解读层**。
 *
 * 从 `ship-core.mjs` 按职责拆出（ISSUE #3201 落地时把 ship-core 顶过 900 行硬闸；
 * 该文件那族「顶到闸上就拆，拆法按职责」的先例见其文件头）：这两个函数都是
 * 「读判据 `--json` 的原值、给这一格该怎么念」—— 解读与转述，不碰退出码表。
 *
 *   · `readFreshnessState`   —— 五态分型（ISSUE #2390：三件不同的事共用一个非零码，
 *     只看退出码必然误读）；
 *   · `freshnessDriftAdvice` —— `drift` 的分形态下一动作（ISSUE #3201：切换分支 /
 *     换基线的现场里 `git pull` 无关、漏 deps:guard 前置）。
 */

/**
 * 读依赖新鲜度判据（`check-deps-freshness.mjs --json`）的**原值**，给出这一格该怎么念。
 *
 * 为什么要读原值而不是只看退出码（ISSUE #2390）：那份判据的三件不同的事**共用一个
 * 非零码** —— 「远端在依赖面上前进过」（真漂移，`git pull` + `pnpm install` 是出口）、
 * 「依赖压根没装」（`installDrift.state = no-install`，出口同样是装，但它**不是漂移**）、
 * 「拿不到 git 状态」（`envBroken`，出口是修环境）。只看退出码就必然把后两种念成
 * 「红了」，而「红了」在本仓三态码里的意思是**有事实是红的** —— 与硬规则 26 /
 * §13.6.3 正面冲突：`node_modules` 缺失只表示「还没装」，**不表示「本机跑不了门禁」**。
 *
 * 五种回答，**一个都不许合并**（「没测」与「测出来是红的」分开是本条的全部要害）：
 *
 * @param {{status?:number, stdout?:string, stderr?:string, error?:string|null}|null} res 执行者回来的原值
 * @returns {"clean"|"drift"|"no-install"|"env"|"unknown"}
 *   `clean` 一致 · `drift` 真漂移（②/③ 命中）· `no-install` 还没装 ·
 *   `env` 判据自己没跑起来 · `unknown` 读数不完整（起不来 / 形状对不上）
 */
export function readFreshnessState(res) {
  let json;
  try {
    json = JSON.parse(res?.stdout ?? "");
  } catch {
    return "unknown";
  }
  if (!json || typeof json !== "object") {
    return "unknown";
  }
  /* 判据自己的「没跑起来」压过一切（与它的退出码顺序同口径：环境不可信时
   * 红与绿都不构成结论）。 */
  if (json.envBroken === true) {
    return "env";
  }
  if (!("code" in json)) {
    return "unknown";
  }
  const state = json.installDrift?.state;
  /* `no-install` 与「远端漂移」可能同时成立（没装 + 远端改过依赖）：那时要念的是**漂移**，
   * 因为它的出口（先 pull 再装）才是完整动作 —— 只说「没装」会让人在旧基线上装一套旧依赖。 */
  if (state === "no-install" && (json.remoteDrifts ?? []).length === 0) {
    return "no-install";
  }
  if (Number(json.code) === 0) {
    return "clean";
  }
  return "drift";
}

/**
 * `drift` 的**分形态下一动作**（ISSUE #3201）：判据 `--json` 已经把三件不同的事
 * 分得很清（`remoteDrifts` = ② 基线漂移；`installDrift` = ③ 安装漂移），固定话术
 * 「先 `git pull` + `pnpm install`」在「切换分支 / 换基线」的现场两处不准 ——
 * 本检出已经在新基线上、没有可拉的提交，红的是 ③；且漏了硬规则 9 的前置
 * `pnpm deps:guard`（实例在跑时原生模块被锁，直接 install 会 EPERM 连锁失败）。
 *
 * 只读原值给**转述**（红线③）：判据本身不改、这里不代判、不新增旗标。
 * `remoteDrifts` 为空数组而结构化读数缺席（`envBroken`）时按「远端没改过」算 ——
 * 那一格的字段语义就是「缺席 ≠ 漂移」（与 readFreshnessState 同一取法）。
 *
 * @param {{status?:number, stdout?:string, stderr?:string, error?:string|null}|null} res 执行者回来的原值
 * @returns {{shape:"remote"|"install"|"both"|"generic", lines:string[]}} 形态与**可直接逐行打印**的话术
 */
export function freshnessDriftAdvice(res) {
  let json;
  try {
    json = JSON.parse(res?.stdout ?? "{}");
  } catch {
    json = {};
  }
  const remoteCount = Array.isArray(json?.remoteDrifts) ? json.remoteDrifts.length : 0;
  const installDrift =
    json?.installDrift !== null &&
    json?.installDrift !== undefined &&
    json.installDrift.state !== "no-install";
  const guard = "`pnpm deps:guard && pnpm install`";
  const guardWhy =
    "（`deps:guard` 先判本检出的应用实例在不在跑 —— 硬规则 9：在跑时原生模块被锁，" +
    "直接 install 会 EPERM 连锁失败）";
  const guide = "同步口径与完整步骤见 `docs/guides/sync-after-pull.md`。";
  if (remoteCount > 0 && installDrift) {
    return {
      shape: "both",
      lines: [
        "[ship] 依赖新鲜度红了（硬规则 25）—— 远端基线在依赖面上前进过，本地安装面也有漂移。",
        `[ship] 下一动作：先 \`git pull\` 同步基线，再 ${guard}${guardWhy}。${guide}`,
      ],
    };
  }
  if (remoteCount > 0) {
    return {
      shape: "remote",
      lines: [
        "[ship] 依赖新鲜度红了（硬规则 25）—— 远端基线在依赖面上前进过 ⇒ 先 `git pull` 同步基线，" +
          `再 ${guard}${guardWhy}。`,
      ],
    };
  }
  if (installDrift) {
    return {
      shape: "install",
      lines: [
        "[ship] 依赖新鲜度红了（硬规则 25）—— 本地 `node_modules` 装的不是当前检出声明的那套依赖" +
          "（切换分支 / 换基线后的常见形态）⇒ 与「拉远端」无关，本检出没有可拉的提交。",
        `[ship] 下一动作：${guard}${guardWhy}。${guide}`,
      ],
    };
  }
  /* 读数分层不完整（起不来 / 形状对不上）：保守给通用出口，两样都点，不编归因。 */
  return {
    shape: "generic",
    lines: [`[ship] 依赖新鲜度红了（硬规则 25）⇒ 先 ${guard} 再回来${guardWhy}。${guide}`],
  };
}
