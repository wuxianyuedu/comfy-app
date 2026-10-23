/**
 * `declared-hook-steps.mjs` —— 钩子步骤的**应然注册表**（ISSUE #2235）。
 *
 * ## 它补的是哪一格
 *
 * `.githooks/pre-commit` 把「重档不在每次提交上跑」做成**只关执行时机、不关注册表**
 * （§13.5.25）：步骤行逐字留在钩子里，`scripts/check-gate-executors.cjs` 按文本认它们。
 * 于是「把步骤删掉」这一种降档必须有人当场拦 —— 而拦它的判据（`tests/commit-gate-tier.test.ts`）
 * 过去钉的是**当天的存量总数**（`56 / 17 / 39` 三个手写数）。那三个数正是 #2135 点名的
 * 那族病灶：**把存量钉成常数，而改动面追不到它** ——
 * 加一步要同批改三个数，忘了就红；而这个红只落在**之后每一条 PR** 上（这份测试读的是
 * 钩子文本，没有 import 依赖 ⇒ 改钩子那条线自己选不到它）。
 *
 * ## 应然从哪来（为什么这不是一份「抄本的抄本」）
 *
 * 下面两份名单是**规约**，不是镜像：判的是「这些判据必须有执行者」，方向只有一个 ——
 * 谁把它们从钩子里拿走，谁就得在这里一起拿掉，而那一行 diff 就是 §13.5.25 要看得见的那件事。
 * 消费方拿到的总数与边界都**由名单派生**，所以：
 *
 *   · **加一步**（并登记）⇒ 名单自己长，测试不必改任何数字；
 *   · **裸加一步**（没登记）⇒ `钩子有 / 注册表没有` ⇒ 红，**点名是哪条**；
 *   · **删一步**（降档做成删步骤）⇒ `注册表有 / 钩子没有` ⇒ 红，同样点名。
 *
 * 后两条比旧的「总数不等」强一处：总数不等只说「差一条」，说不出差的是哪一条，
 * 而排查那一句「差在哪」正是要人把 56 行重读一遍。
 *
 * 双向核对的另一端始终是**解析器** `readHookSteps()` / `localTierLabels()`
 * （住在隔壁 `hook-steps.mjs`，那份解析器也是 `base-check` 与钩子档位开关共用的），
 * 这里不另写第二份解析（§12.12 / §12.18）。
 *
 * ## 名单为什么按档分两份
 *
 * D0 是「本地每次都跑的形态前置档」，它的**成员**与**在钩子里的位置**（先于其余档串行跑完）
 * 都是口径；D 是「默认由推送那一跳与平台复算」的重档。两份名单分开列，于是
 * `localTierLabels()`（从钩子的 D0 块现算）与 `DECLARED_D0_STEPS` 互为对账 ——
 * 把一条判据挪出 D0 而不在这里登记，两个方向都会红。
 */

/** 本地形态前置档（D0）：秒级、判「这次提交自身的形态」，在其余档之前串行跑完。 */
export const DECLARED_D0_STEPS = [
  "CHANGELOG 碎片",
  "待发段落的来源锚 ⇄ 条目归属",
  "文档源 ⇄ 生成态镜像同批",
  "判据自身的数值 ⇄ 账同批",
  "被跟踪文字里的凭据形状",
  "每档都有主（新鲜度账：e2e / 全量单测 / 产物三档自证）",
  "UI/逻辑分离硬闸",
  "地基层零消费导出(硬闸)",
  "故事面（title / 接上真组件 / 分组一致 / 必填 props 的 args）",
  "产品版本号三处同步(D7)",
  "ui/ 定制标记与台账（§16.8）",
  "跨平台动作对照(.ps1⇄.mjs)",
  "端口推导跨语言一致性",
  "import 别名统一(~ 前缀)",
  "依赖新鲜度（只判动了依赖面的提交，§13.5.13）",
  "依赖构建脚本与 allowBuilds 对账（只判动了依赖面的提交）",
  "基础设施层文件长度硬闸(scripts+tools，§12.6 R5 姊妹档)",
];

/**
 * 重档静态判据（D 组）：逐字留在钩子里当注册表，默认不在每次提交上跑
 * （执行者是推送那一跳的 `check:premerge` 与平台复合档，§13.5.25）。
 *
 * 刻意**不导出**：对外只有两格需要点名 —— 全量清单（`DECLARED_STEPS`）与本地档成员
 * （`DECLARED_D0_STEPS`，档位开关与 `--light` 的边界就是它）。D 组单独命名只为这份文件
 * 读得动，导出它等于给「谁在跑这批」添第三个出处（§12.16 那条零消费判据会直接点名）。
 */
const D_STEPS = [
  "文件结构硬规则(R1-R12，R5 硬闸)",
  "AST 判据聚合（6 条共享一次解析）",
  "标题行让位硬规则",
  "UI 基元复用棘轮",
  "主题色扫描",
  "ComfyUI 端口口径一致性",
  "内联样式注入",
  "跨文件重复块",
  "函数长度(硬闸，>400 行即阻断)",
  "Rust 函数长度(硬闸，>120 行即阻断)",
  "桌面壳（改了 src-tauri 才跑）",
  "模块循环依赖(硬闸)",
  "入口重依赖静态可达性",
  "格式化提交与行为改动分离",
  "翻闸旗标的散文承诺(硬闸)",
  "浮层层级刻度硬闸",
  "注释语言硬闸",
  "CP936 字形登记（没字形的字符不许悄悄变问号）",
  "用例环境档（环境早退 / 目录档矛盾 / 冗余文件头）",
  "软断言用在循环体里（expect.soft）",
  "并发档位用法（it.concurrent）",
  "类型层断言的执行者（expectTypeOf）",
  "注解消费方（ctx.annotate）",
  "元数据消费方（task.meta）",
  "未完成用例声明（test.todo）",
  "判据执行者台账",
  "CI 档名 ⇄ 执行者台账",
  "声明 ⇄ 读者索引",
  "按需档 ⇄ 执行者索引",
  "已知基线失败登记过期（清单为空时零耗时）",
  "已知基线失败登记·自证（碰了这套机制才跑）",
  "测试层裸 sleep 硬闸（§11.14）",
  "测试层 waitFor 边界（§11.14.3）",
  "测试层一个用例一把时钟（§11.14）",
  "测试层 it.each（§11.15）",
  "门禁自测临时仓库样板（§11.16.1）",
  "jsx-a11y 规则开关⇄判据（§6.12）",
  "用例存量（磁盘 ⇄ vitest.config.ts 收集面）",
  "类型层声明 ⇄ 执行者（tsc 判决面，§13.5.14）",
];

/** 全部应然步骤 —— 总数由这里派生，任何消费方都不该另写一个数。 */
export const DECLARED_STEPS = [...DECLARED_D0_STEPS, ...D_STEPS];

/**
 * 注册表 ⇄ 钩子步骤的双向对账。
 *
 * @param {Array<{label: string}>} hookSteps `readHookSteps()` 的原样输出
 * @param {Set<string>} localTier `localTierLabels()` 的原样输出（D0 块的现算结果）
 * @returns {string[]} 逐条不一致的话术；空数组 = 注册表与钩子说的是同一件事
 */
export function registryProblems(hookSteps, localTier) {
  /** @type {string[]} */
  const problems = [];
  const steps = Array.isArray(hookSteps) ? hookSteps : [];
  const labels = steps.map((s) => String(s?.label ?? ""));
  const inHook = new Set(labels);

  /* 同名标签会让 `resolveGateCommand` 的「唯一命中」当场失效，也会让下面每一处
   * 集合比较失去意义 —— 所以先数重复，再比集合。 */
  const duplicated = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (duplicated.length > 0) {
    problems.push(
      `钩子里有重复的标签：${duplicated.join("、")} —— 标签是命令的入口名，` +
        "重名会让「按标签点名一条判据」变得无法唯一确定",
    );
  }

  for (const label of DECLARED_STEPS) {
    if (!inHook.has(label)) {
      problems.push(
        `注册表里有「${label}」而钩子的步骤行里没有 —— 这一步**没有执行者**了。` +
          "降档的正确做法是换执行者（推送那一跳 / 平台复合档），不是把步骤删掉：" +
          "删掉之后 `check-gate-executors.cjs` 按文本认的那些出处一起消失，账面一条红都不会有。" +
          "确要撤掉这条判据时，连这里那一行一起删（那一行 diff 就是这次口径的痕）。",
      );
    }
  }
  for (const label of inHook) {
    if (!DECLARED_STEPS.includes(label)) {
      problems.push(
        `钩子里有「${label}」而注册表里没有 —— 新增一步必须同批登记进 ` +
          "`scripts/base-check/declared-hook-steps.mjs`（它是「应然清单」的唯一出处）。",
      );
    }
  }

  /* 本地档两向核：成员与位置。位置那一件是语义 —— D0 在其余档之前串行跑完，
   * 「边界取错」的失效形态正是原测试点名的「本地档恰好少一条」那种静默漂移。 */
  const tier = localTier instanceof Set ? localTier : new Set(localTier ?? []);
  for (const label of DECLARED_D0_STEPS) {
    if (!tier.has(label)) {
      problems.push(
        `注册表把「${label}」列为本地形态档（D0），而钩子的 D0 块里没有这一步 —— ` +
          "要么它被挪出了 D0（那本地每次都跑的那批就少了一条，档位话术也跟着漂），" +
          "要么 D0 块的边界变了而解析器读不到它",
      );
    }
  }
  for (const label of tier) {
    if (!DECLARED_D0_STEPS.includes(label)) {
      problems.push(
        `钩子的 D0 块里有「${label}」而注册表没把它列为本地档 —— 「哪几条是秒级形态档」` +
          "这一格必须只有一处出处（消费方是钩子的档位开关与 `premerge-check` 的 `--light`）",
      );
    }
  }
  const head = labels.slice(0, DECLARED_D0_STEPS.length);
  if (
    head.length !== DECLARED_D0_STEPS.length ||
    head.some((l, i) => l !== DECLARED_D0_STEPS[i])
  ) {
    problems.push(
      `钩子开头的 ${DECLARED_D0_STEPS.length} 条步骤与注册表的 D0 名单不是同一批 —— ` +
        "D0 是「串行跑完再进其余档」那一档，顺序与成员一起才算这条边界",
    );
  }
  return problems;
}
