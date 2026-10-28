/**
 * 「哪几格进容器、为什么」—— 从 `.cnb.yml` 里**读出来**，并把它变成会红的判据（ISSUE #1993）。
 *
 * ## 它要回答的那一格
 *
 * 用户的决定只有一句：**「永远不用平台池，使用自托管节点上的容器」**。这句话在配置里
 * 不是一个键，而是三件事的合取 —— 而三件里任一件写错，症状都是「看起来对、其实跑在
 * 别处」：
 *
 * 1. `runner.namespace: group`（自托管）与 `runner.tags` 非空 —— 漏掉 namespace 会
 *    **静默回落计费的平台池**，配置一模一样；
 * 2. 自托管节点离线 / 满载时平台会**自动改派到其他可用节点**，而「其他可用节点」
 *    在这条路径上就是平台池（`.cnb.yml` 头注第 5 条）。所以只写 namespace 不够，
 *    还必须写 **`runner.tags` 里那个只有自托管节点才有的标签**；
 * 3. 「用容器」落在 **Job 级 `image:`**（`pipeline.docker.image` 在自托管上不生效，
 *    而 **stage 级 `image:`** 也不生效 —— 它不是「被忽略」，是整格 99ms 就答
 *    `Runner does not enable Docker.`；见 §13.5.3.4.1 与 `imageLevelOf()`）
 *
 * ## 两级模型（本文件的全部内容）
 *
 * | 档 | 谁 | 为什么 |
 * | --- | --- | --- |
 * | **宿主直跑** | 静态判据、构建、单测 | 它们的输入就是这份检出；逐个进容器 = 每格一份新环境、一次新安装，而隔离换不到任何东西 |
 * | **Job 级容器** | 「在等网络」的那几格 | 宿主机没有 docker 就没有镜像兜底，而这台节点的链路一次取不完一个大响应 |
 *
 * **两档之间只有一条桥**：宿主必须给容器留下一份**跨容器存活**的落点（Playwright
 * 浏览器），否则每一格都重下 120 MiB —— 那正是要买的东西被悄悄退回去的形态，
 * 而它不报错、只是慢。`volumes()` 就是这条桥的声明；`plan()` 把「哪几格、挂什么、
 * 缺哪一件」合成一句话。
 *
 * ## 边界：本文件**不碰 docker**、**不出网**
 *
 * 与 `ci-image-plan.mjs` / `ci-image-identity.mjs` 同一条分工：能判的只有「声明对不对」，
 * 「那台机拉不拉得下来」只有平台侧日志答得出（§13.5.3.4.1.1 第 3 条）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CNB_CONFIG = ".cnb.yml";

/** 自托管节点的标签 —— **仓里唯一一处**（判据与文档都从这里取）。 */
export const SELF_HOSTED_TAG = "win";

/** 平台池的标签前缀：出现它 = 这一格跑在计费节点上（用户明令禁止的那一档）。 */
export const PLATFORM_POOL_TAG_PREFIX = "cnb:arch:";

/** 浏览器落点：容器格共享的那份卷挂在这里，跨容器存活。 */
export const BROWSERS_VOLUME = "/ms-playwright";

/**
 * 逐行剥掉 YAML 的 `#` 注释（注释从 `#` 到行尾），引号里的 `#` 不算。
 *
 * ⚠️ **这不是 `tests/helpers/strip-comments.ts` 那一份**，也不是它的变体：那份剥的是
 * **JS 源码**（`/* … *\/` 与整行 `//`），而这里剥的是 YAML，且必须**连行尾注释一起去**
 * —— 本仓 `.cnb.yml` 里 `namespace:` / `image:` 出现在行尾注释里是常态（一段注释解释
 * 「反例长什么样」），只去整行会把它们读成声明。所以两边语义不同、各有各的用途，
 * 名字也刻意不同（`stripYamlComments`）—— 撞名会让下一个读的人以为是同一件事。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function stripYamlComments(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== null) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          continue;
        }
        if (ch === "#") return line.slice(0, i);
      }
      return line;
    });
}

/**
 * 把注释行**替换成空行**（不删）—— 行号与缩进层级都保持不变，下游按缩进判层级的
 * 解析器才不会因为「注释被删掉、上下文挪了位」而读错。
 *
 * @param {string} text
 */
const blankComments = (text) => stripYamlComments(text).join("\n");

/**
 * `runner:` 那一块的读数：自托管 / 平台池 / 没写。
 *
 * **只认第一个 `runner:`**，且**按任意缩进**认 —— 本仓的 `runner` 挂在 `.common: &common`
 * 锚点下（不是顶层键），锚点被 `<<: *common` 引用时平台读的就是那一份。写成「顶层」
 * 会一个都匹配不到，于是「配置明明写了自托管」与「一个字没写」在读数里逐字同形。
 * 其余同名键只可能是注释（已剥）。这也顺手钉死了「只有一份 runner 配置」：第二份会漂。
 *
 * @param {string} text
 * @returns {{ namespace: string | null, tags: string[], verdict: "self-hosted" | "platform-pool" | "missing" }}
 */
export function runnerShape(text) {
  const lines = blankComments(text).split("\n");
  const start = lines.findIndex((l) => {
    const body = l.trim();
    /* `- runner:` 也算（列表项里的键）；只认键本身，不认 `something-runner:`。 */
    return body === "runner:" || body === "- runner:";
  });
  if (start < 0) return { namespace: null, tags: [], verdict: "missing" };
  const first = lines[start] ?? "";
  const runnerIndent = first.length - first.trimStart().length;
  let namespace = null;
  /** @type {string[]} */
  const tags = [];
  let mode = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const body = raw.trim();
    if (body === "") continue;
    const indent = raw.length - raw.trimStart().length;
    /* 回到 runner 那一层或更浅 ⇒ 这一块结束了。 */
    if (indent <= runnerIndent) break;
    if (body.startsWith("namespace:")) {
      namespace = body.slice("namespace:".length).trim();
      mode = null;
      continue;
    }
    if (body.startsWith("tags:")) {
      mode = "tags";
      continue;
    }
    if (mode === "tags" && body.startsWith("- ")) {
      tags.push(
        body
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, ""),
      );
      continue;
    }
    /* 别的键（`cpus:` 等）⇒ tags 那一块收尾。 */
    mode = null;
  }
  const selfHosted = namespace === "group" && tags.length > 0;
  const pooled = tags.some((t) => t.startsWith(PLATFORM_POOL_TAG_PREFIX));
  return {
    namespace,
    tags,
    verdict: selfHosted && !pooled ? "self-hosted" : "platform-pool",
  };
}

/**
 * 容器格的清单：Job 级 `image:` 写了的，以及它挂的卷。
 *
 * ⚠️ 认的是 **Job** 那一层的 `image:` / `volumes:`（`- name: X` + `jobs:` + 同名 Job）。
 * 原因不是风格：stage 级 `image:` 在自托管上会让整格**起不来**（平台答
 * `Runner does not enable Docker.`，因为两层语义不同 —— stage 级换的是整条流水线的
 * 构建环境，Job 级只给这一个任务起容器）。所以这里读的是 Job 那两行，stage 名取外层
 * （判据与账里一直用外层名；Job 层的同名只是为了让那一层有名字）。
 *
 * 只给 stage 写了 `image:` 而没拆 `jobs:` 的那一形态，本函数**不会**把它算成容器格
 * —— 它压根跑不起来，那是 `stageLevelImages()` 那条判据的事（下一动作是「拆成 Job」，
 * 不是「补卷」）。两件事混成一份名单，读起来就像两种失效形态是同一种。
 *
 * 与 `ci-image-identity.mjs` 的 `platformImageStages()` 是**同一个事实的两个读数**：
 * 那边只取「哪几格有 `image:`」（一行读数），这边多取「挂在哪、缺什么」（判据面）。
 * 不合并成一个函数是因为两者的失效形态不同 —— 那边的判据是「名单逐格点名」，
 * 这边的判据是「跨容器存活的落点有没有声明」。
 *
 * @param {string} text
 * @returns {Array<{ name: string, image: string, volumes: string[] }>}
 */
export function containerStages(text) {
  /** @type {Array<{ name: string, image: string, volumes: string[] }>} */
  const out = [];
  /* 每一项先收齐自己的键（`image:` 与 `volumes:` 的**先后不定**，所以必须等这一项
   * 结束再判定），再决定它是不是容器格。 */
  /** @type {string | null} */
  let stageName = null;
  /** @type {number | null} */
  let stageIndent = null;
  /** @type {{ name: string, image: string, volumes: string[] } | null} */
  let current = null;
  let volumesMode = false;
  const flush = () => {
    if (current !== null && current.image !== "")
      out.push({
        name: current.name,
        image: current.image,
        volumes: current.volumes,
      });
    current = null;
    volumesMode = false;
  };
  /** @type {number | null} */
  let itemIndent = null;
  for (const raw of blankComments(text).split("\n")) {
    const body = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0 && body !== "") {
      flush();
      itemIndent = null;
      stageName = null;
      stageIndent = null;
      continue;
    }
    if (body.startsWith("- name:")) {
      flush();
      itemIndent = indent;
      const name = body.slice("- name:".length).trim();
      /* 比当前 stage 更深的那一项是**子 Job**（`jobs:` 下），否则它就是一个新 stage。 */
      if (stageIndent === null || indent <= stageIndent) {
        stageName = name;
        stageIndent = indent;
      }
      /* 只有 Job 那一层才有 `image:` 的语义 —— stage 那一层收到的东西由
       * `stageLevelImages()` 那条判据点名（见上）。 */
      current =
        stageIndent !== null && indent > stageIndent
          ? { name: stageName ?? name, image: "", volumes: [] }
          : null;
      continue;
    }
    if (current === null || itemIndent === null) continue;
    /* 项**自己的**键：比 `- name:` 深一层。更深的是 `env:` / `volumes:` 的**条目**，
     * 那两处出现同名键不算（`env:` 里的 `image:` 是另一个东西）。 */
    if (indent === itemIndent + 2) {
      volumesMode = body.startsWith("volumes:");
      if (body.startsWith("image:")) {
        current.image = body
          .slice("image:".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
      continue;
    }
    /* `volumes:` 的条目：`- 卷名:容器内路径`。 */
    if (volumesMode && indent > itemIndent + 2 && body.startsWith("- ")) {
      current.volumes.push(
        body
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, ""),
      );
    }
  }
  flush();
  return out;
}

/**
 * 容器格的「跨容器存活」清单：`volumes:` 里冒号后面的**容器内路径**。
 *
 * 写成 `<卷名>:<容器内路径>`（与 docker 的 `-v` 同形），冒号前那一段就是「谁在
 * 存活」—— 本仓只用命名卷（宿主路径在这条路径上不可假定，且宿主是 Windows）。
 *
 * @param {string} spec
 * @returns {{ source: string, target: string } | null}
 */
export function parseVolume(spec) {
  const text = String(spec)
    .trim()
    .replace(/^["']|["']$/g, "");
  const at = text.indexOf(":");
  if (at <= 0 || at === text.length - 1) return null;
  return { source: text.slice(0, at), target: text.slice(at + 1) };
}

/**
 * **写错层**的那一格：`image:` 挂在 **stage** 上而不是 Job 上。
 *
 * 这不是「另一个可选写法」，是这一条路径上**整格起不来**的形态 —— 实测
 * （`Runner does not enable Docker.`，99ms，容器都没起）。两层语义不同：stage 级
 * 换的是**整条流水线**的构建环境（自托管 Runner 不具备的能力），Job 级只给**这一个
 * 任务**起容器（照常可用）。所以它单列一个出口 —— 与 `containerStages()` 合成一份
 * 名单会让它读起来像「多挂了个卷」那种可容忍的毛病。
 *
 * @param {string} text
 * @returns {Array<{ name: string, image: string }>}
 */
export function stageLevelImages(text) {
  /** @type {Array<{ name: string, image: string }>} */
  const out = [];
  /** @type {{ name: string, indent: number } | null} */
  let stage = null;
  for (const raw of blankComments(text).split("\n")) {
    const body = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0 && body !== "") {
      stage = null;
      continue;
    }
    if (body.startsWith("- name:")) {
      const item = { name: body.slice("- name:".length).trim(), indent };
      /* 比当前 stage 更深的是子 Job —— stage 那一层（同一个缩进）不换主。 */
      if (stage === null || indent <= stage.indent) stage = item;
      continue;
    }
    if (stage === null || !body.startsWith("image:")) continue;
    const value = body
      .slice("image:".length)
      .trim()
      .replace(/^["']|["']$/g, "");
    /* 只认 stage 项自己那一层（更深的是 Job 的 `image:`，那是**对**的那一层）。 */
    if (value !== "" && indent === stage.indent + 2)
      out.push({ name: stage.name, image: value });
  }
  return out;
}

/**
 * 一句话的计划读数：宿主直跑几格、容器几格、桥断在哪。
 *
 * `bridge` 是本文件真正想说的话：
 * - `"none"` —— 没有容器格，不需要桥；
 * - `"complete"` —— 有容器格，且每一格都挂着同一份浏览器落点；
 * - `"broken"` —— 有容器格，但至少一格没挂 ⇒ **每一格都会重下那 120 MiB**
 *   （不报错，只是慢 —— 那正是最贵的失效形态）。
 *
 * @param {string} text
 * @returns {{ runner: ReturnType<typeof runnerShape>, hosts: string[], containers: Array<{name: string, image: string, volumes: string[]}>, bridge: "none" | "complete" | "broken", missing: string[], stageLevel: Array<{name: string, image: string}> }}
 */
export function plan(text) {
  const runner = runnerShape(text);
  const containers = containerStages(text);
  const missing = containers
    .filter(
      (s) => !s.volumes.some((v) => parseVolume(v)?.target === BROWSERS_VOLUME),
    )
    .map((s) => s.name);
  const bridge =
    containers.length === 0
      ? "none"
      : missing.length === 0
        ? "complete"
        : "broken";
  return {
    runner,
    hosts: [],
    containers,
    bridge,
    missing,
    /* 写错层的那一格（见 `stageLevelImages()`）—— 它不在 `containers` 里，
     * 因为那一格压根跑不起来，没有「挂没挂卷」可判。 */
    stageLevel: stageLevelImages(text),
  };
}

/**
 * 把计划打成几行人读的话（`镜像身份` 那一档每跑打一遍）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]}
 */
export function describePlan(text) {
  const p = plan(text);
  const lines = [];
  lines.push(
    `容器计划：runner ${p.runner.verdict}（namespace=${p.runner.namespace ?? "（没写）"}，tags=[${p.runner.tags.join(", ")}]）`,
  );
  if (p.stageLevel.length > 0) {
    /* 这一行必须排在最前：写错层时整格起不来，此时再报「几格进容器」是把
     * 一个更重的结论排在更轻的那个后面。 */
    lines.push(
      `容器计划：⚠️ 这些格的 \`image:\` 写在 **stage** 上 —— 自托管上整格会以「Runner does not enable Docker.」失败，要拆成 \`jobs:\` + Job 级 \`image:\`：${p.stageLevel
        .map((s) => s.name)
        .join(" / ")}`,
    );
  }
  if (p.containers.length === 0) {
    lines.push("容器计划：没有 Job 级 `image:` 格 —— 整条跑在宿主机上");
    return lines;
  }
  lines.push(
    `容器计划：${p.containers.length} 格进容器 —— ${p.containers
      .map((s) => `${s.name} → ${s.image}`)
      .join("；")}`,
  );
  lines.push(
    p.bridge === "complete"
      ? `容器计划：浏览器落点 ${BROWSERS_VOLUME} 由每一格挂同一份卷（跨容器存活，不重下）`
      : `容器计划：⚠️ 这些格没挂 ${BROWSERS_VOLUME} —— 每一格都会重下 120 MiB：${p.missing.join(" / ")}`,
  );
  return lines;
}

/* 直接跑（`node scripts/ci-container-plan.mjs`）：纯打印、恒退 0 —— 它是读数，
 * 判据在 `tests/ci-container-plan.test.ts`。 */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const text = readFileSync(path.join(ROOT, CNB_CONFIG), "utf8");
  for (const line of describePlan(text)) console.log(line);
}
