/**
 * 「这台构建机是**从哪张镜像**长出来的」—— 流水线上的**读数**，不是判据（ISSUE #1993）。
 *
 * ## 它要回答的那个问题
 *
 * 镜像的用法在很多人的脑子里是「流水线声明它，于是环境就是它」。自托管这条路上
 * 没有那一层（`.cnb.yml` 里刻意不声明 `docker.image`，写了也不生效）—— 所以唯一
 * 还能让「这台机器长自哪张镜像」这件事**可追**的地方，是**人**在装机时钉进环境的
 * 那两个标识。缺了它们，「这台节点跑的是哪一版工具链」只能靠翻上一次的红色日志
 * 反推，而那正是 §13.5.3.5 那张清单重复出现的成因：**环境是隐形的**。
 *
 * ## 为什么它是读数而不是判据
 *
 * 三个理由，每个都能独立成立：
 *
 * 1. **本仓的工具链靠断言守，不靠镜像守**。`工具链自证` 已经判 git / node / pnpm /
 *    Python 四件、`环境前提` 判版本下限 —— 那些是**实际能力**，而镜像标识是
 *    **期望身份**。两者不一致时该信谁已经写死了（能力那一侧），再加一条镜像判据就是
 *    第二个判据源（§12.18）。
 * 2. **没有标识不等于这台机器不对**：本路径的历史形态就是「裸装机 + 三件套」，
 *    把人第一次接进节点时的一跑判红，等于用一条与新事实无关的红挡住所有变更。
 * 3. **标识对不对得上镜像库，这件事本进程判不了**：构建容器里既没有 docker daemon，
 *    也没有那份镜像的 digest —— 「查得到」是人的动作。（与日志乱码那一格同形：
 *    抓取端的解码发生在本进程之外，本进程能判的只有宿主读数。）
 *
 * 所以它做三件事：把磁盘上**真的**有什么（OS / kernel）与**声明的**身份（环境变量）
 * 一起打出来、把「声明与磁盘对不上」的那几档写成读数、以及**没有标识时给出下一动作**。
 * 它恒退 0。
 *
 * ## 第四件事（ISSUE #1993 续）：它也报「本仓的容器格是哪几格」
 *
 * 「宿主机直跑」与「这一格跑在容器里」不是二选一 —— 平台侧**Job 级** `image:`
 * 与插件任务仍然在容器里跑（`.cnb.yml` 里 `浏览器安装` / `E2E 关键流程` 两格就是）。
 * 那句话此前只写在文档里，于是「到底哪几格在容器里」只能靠人翻 900 行 YAML。
 * 现在它由 `platformImageStages()` 从 `.cnb.yml` 里**读出来**，跟着这条读数每跑一次
 * 打一遍 —— 判据面仍在 `tests/ci-image-identity.test.ts`（哪几格该有 `image:` 由它钉住），
 * 这里只负责「让这一跑的形态可见」。
 *
 * ## 两个标识只有一份出处
 *
 * `COMFYAPP_NODE_IMAGE`（钉版本标签的镜像引用）与 `COMFYAPP_NODE_IMAGE_DIGEST`
 * （那一次的 digest）在本文件里定义，`tests/ci-image-identity.test.ts` 判它们
 * 「在盘上有人写、在文档里有人读」—— 名字散落成字面量就会有两份答案。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/* 容器计划的读数与**同一个事实**的另一个出口（ISSUE #1993）：哪几格进容器、它们挂的
 * 卷能不能让浏览器落点跨容器存活、runner 是不是自托管。本档只**打**它，判据在
 * `tests/ci-container-plan.test.ts` —— 分工与 `platformImageStages()` 一致。 */
import { describePlan } from "./ci-container-plan.mjs";

/** `.cnb.yml` 里本仓认得的那一档「Job 级镜像」—— 宿主机没 docker 之后容器仍从这一格来。 */
const CNB_CONFIG = ".cnb.yml";

/** 镜像引用（**必须钉版本标签**，`latest` 会让「哪一版」这件事彻底不可追）。 */
export const IMAGE_ENV = "COMFYAPP_NODE_IMAGE";
/** 那一次的 digest（`sha256:…`）—— 标签可以被移动，digest 不会。 */
export const DIGEST_ENV = "COMFYAPP_NODE_IMAGE_DIGEST";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根 —— 本脚本住在 `scripts/` 下。 */
export const ROOT = path.resolve(HERE, "..");

/**
 * 从 `.cnb.yml` 原文里读出**哪几格在容器里跑**（Job 级 `image:`）。
 *
 * ## 为什么这件事要有执行者
 *
 * 自托管这条路上「镜像」一度被读成「没有」（§13.5.3.4.1 那张表的第一条：`pipeline
 * .docker.image` 不生效）。可失效的只是**声明构建环境**那一层 —— 平台侧**Job 级**
 * `image:` 与插件任务仍在独立容器里执行（官方 `script-vs-plugin.md`「执行环境」：
 * 指定 `image` 的脚本任务在独立容器中执行）。于是本仓的真实形态是
 * **宿主机直跑 + 少数几格进容器**，而不是「整条没有镜像」。
 *
 * 那句话此前只写在文档里；写进读数之后，「这一跑是哪几格换了环境」跟着每次构建
 * 落进日志 —— 与这条读数存在的理由逐字相同（环境是隐形的）。
 *
 * ## 认的是 **Job** 那一层，而且只认那一层
 *
 * 平台有两层镜像语义，在这条路径上**一层能用、一层不能**（实测：写错那一层，整格
 * 99ms 就答 `Runner does not enable Docker.`）：
 *
 *   · **Job 级**（脚本任务「指定 `image` 时在独立容器中执行」）= 平台为这一个任务起
 *     一个容器 —— 自托管上照常可用，**本仓用这一层**；
 *   · **Stage 级**（`Stage.image`「当前 Stage 下的所有任务默认都在这个镜像环境中执行」）
 *     = 给整条流水线容器换镜像 —— 那正是自托管 Runner 不具备的能力。
 *
 * 所以本函数对两者**分开报**：Job 级的 `image:` 进 `stages`，Stage 级的进
 * `stageLevelImages`（后者不是「另一份名单」，而是**一级不该出现的声明** ——
 * 判据要求它为空，理由见 `tests/ci-container-plan.test.ts`）。
 *
 * 缩进判据是有意的：`env:` 里的同名键不会撞上（它们的缩进更深），而 `# ` 注释掉的
 * 那一行也不匹配。stage 名取**外层**那个（`- name: X` + `jobs:`）—— 判据与账里
 * 一直用外层名，Job 层的同名只是为了让那一层有名字。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Array<{name: string, image: string}>} 有序，与配置里出现的顺序一致
 */
export function platformImageStages(text) {
  return readImageDeclarations(text).stages;
}

/**
 * 两级 `image:` 的**一次扫描、两个出口**（Job 级 / Stage 级）。
 *
 * 分开成两个出口而不是一个「合并后的名单」，是因为两边的**下一动作相反**：
 * Job 级多一格是「有人多花了一次安装」，Stage 级出现一格是「这一格在这条路径上
 * 根本起不来」。合成一份名单会让后者读起来像前者。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {{stages: Array<{name: string, image: string}>, stageLevelImages: Array<{name: string, image: string}>}}
 */
export function readImageDeclarations(text) {
  /* ⚠️ **不写 `^ {n}` 那一族正则**：这台机（Node 24 的 V8）在「锚 + 定长量词 +
   * 后续字面量」上会漏回溯 —— `^ {2}a` 对 `"    a"` 判 false（`^a{2}b` 对 `"aaab"`
   * 同样判 false）。本函数要判的是缩进层级，按字符计数比量词直白得多，也顺手绕开
   * 那个坑；**别为了迁就引擎去改用例的期望值**。 */
  /** @type {Array<{name: string, image: string}>} */
  const stages = [];
  /** @type {Array<{name: string, image: string}>} */
  const stageLevelImages = [];
  /** @type {{name: string, indent: number} | null} */
  let stage = null;
  /** @type {{name: string, indent: number} | null} */
  let job = null;
  for (const raw of text.split("\n")) {
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    /* 回到顶层键（`master:` 等）：这一族结束了。`stages:` 那一层不结束 —— 后面还有项。 */
    if (indent === 0 && body !== "") {
      stage = null;
      job = null;
      continue;
    }
    /* 列表项：`- name: X`（缩进多少层都认 —— `stages:` 可能嵌在 pipeline 里）。
     * 比当前 stage 更深的那一项是**子 Job**（`jobs:` 下），否则它就是一个新 stage。 */
    if (body.startsWith("- name:")) {
      const item = { name: body.slice("- name:".length).trim(), indent };
      if (stage !== null && indent > stage.indent) job = item;
      else {
        stage = item;
        job = null;
      }
      continue;
    }
    /* 这一项自己的键：比它的 `- name:` 深一层。更深的是 `env:` / `volumes:` 里的
     * 同名键或条目，不算声明。 */
    if (!body.startsWith("image:")) continue;
    const value = body
      .slice("image:".length)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value === "") continue;
    if (job !== null && indent === job.indent + 2)
      stages.push({ name: stage?.name ?? job.name, image: value });
    else if (stage !== null && indent === stage.indent + 2)
      stageLevelImages.push({ name: stage.name, image: value });
  }
  return { stages, stageLevelImages };
}

/**
 * 标签的三种形态，**读数分三档**（判读只有一处：`tests/ci-image-identity.test.ts`
 * 与规范 §13.5.3.4.1 的「宿主侧怎么用起来」那一段）。
 *
 * - `pinned`   —— `<repo>:<tag>` 且 tag 不是 `latest`：可用，且「哪一版」答得出来；
 * - `floating` —— 标签是 `latest`：能拉，但复现性为零（换一次就是一个没记录的环境）；
 * - `missing`  —— 没给 / 给的是空串：这台机是「裸装机」形态，不是错误，只是没身份。
 *
 * @param {string | undefined | null} image
 * @returns {{verdict: "pinned" | "floating" | "missing", tag: string | null}}
 */
export function imageTagVerdict(image) {
  const text = String(image ?? "").trim();
  if (text === "") return { verdict: "missing", tag: null };
  /* 取最后一段的 `:` 之后 —— 前面可能带 registry 域名与端口（`host:5000/ns/r:tag`），
   * 所以不能按第一个 `:` 切（那会把端口当成标签）。`@sha256:` 形态没有标签，
   * 它本身就是钉死的，按 `pinned` 认（digest 比标签更硬）。 */
  if (text.includes("@sha256:")) return { verdict: "pinned", tag: null };
  const lastSegment = text.slice(text.lastIndexOf("/") + 1);
  const at = lastSegment.lastIndexOf(":");
  const tag = at < 0 ? null : lastSegment.slice(at + 1);
  if (tag === null) return { verdict: "floating", tag: null };
  return { verdict: tag === "latest" ? "floating" : "pinned", tag };
}

/**
 * digest 的形态判读：`sha256:` 加 64 位十六进制。**只判形态，不判真伪** ——
 * 「这个 digest 是不是那张镜像」只有镜像库答得出（本进程查不到，见文件头）。
 *
 * @param {string | undefined | null} digest
 * @returns {"ok" | "malformed" | "missing"}
 */
export function digestVerdict(digest) {
  const text = String(digest ?? "").trim();
  if (text === "") return "missing";
  return /^sha256:[0-9a-f]{64}$/i.test(text) ? "ok" : "malformed";
}

/**
 * 磁盘上**真的**是什么（OS 发布名 / kernel 版本）。
 *
 * 为什么不用 `process.platform` 单独作答：它只说 `linux`，而「长自哪张镜像」要的
 * 是**发行版**那一格 —— 两行 `/etc/os-release` 就够，读不到时如实答「读不到」。
 *
 * @param {{ exists?: (p: string) => boolean, readFile?: (p: string) => string }} [options]
 * @returns {string}
 */
export function osRelease({
  exists = existsSync,
  readFile = (p) => readFileSync(p, "utf8"),
} = {}) {
  const file = "/etc/os-release";
  if (!exists(file))
    return `${process.platform} ${process.arch}（没有 /etc/os-release）`;
  try {
    const text = readFile(file);
    const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(text)?.[1];
    const version = /^VERSION_ID="?([^"\n]+)"?/m.exec(text)?.[1];
    const name =
      pretty ?? (version ? `Linux ${version}` : "Linux（发行版名读不出）");
    return `${name} / ${process.platform} ${process.arch}`;
  } catch (error) {
    /* 读不到就如实说读不到 —— 那不是判据，别把一次 IO 失败写成「环境不对」。 */
    return `${process.platform} ${process.arch}（/etc/os-release 读不动：${/** @type {Error} */ (error).message}）`;
  }
}

/**
 * 读数本体（**恒退 0**；`notes` 与 `problems` 的界线见文件头）。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   osReleaseImpl?: () => string,
 *   kernelImpl?: () => string,
 *   readConfig?: () => string,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {{lines: string[], verdict: "pinned" | "floating" | "missing",
 *            digest: "ok" | "malformed" | "missing", exitCode: 0}}
 */
export function imageIdentity({
  env = process.env,
  osReleaseImpl = () => osRelease(),
  kernelImpl = () => `${os.type()} ${os.release()}`,
  /* 配置原文的读法可注入：判据要能喂夹具，而**缺省读的就是盘上那一份**
   * ——「哪几格在容器里」这件事只许有一个事实源（`.cnb.yml`）。 */
  readConfig = () => readFileSync(path.join(ROOT, CNB_CONFIG), "utf8"),
  log = console.log,
} = {}) {
  const image = env[IMAGE_ENV];
  const digest = env[DIGEST_ENV];
  const tag = imageTagVerdict(image);
  const dig = digestVerdict(digest);

  /** @type {string[]} */
  const lines = [];
  lines.push(`== 镜像身份 ==`);
  lines.push(`磁盘上的系统：${osReleaseImpl()}`);
  lines.push(`内核：${kernelImpl()}`);
  lines.push(`节点主机名：${os.hostname()}`);
  lines.push(
    `${IMAGE_ENV}：${tag.verdict === "missing" ? "（没有声明）" : String(image).trim()}`,
  );
  lines.push(
    `${DIGEST_ENV}：${dig === "missing" ? "（没有声明）" : String(digest).trim()}`,
  );

  /* 本仓的容器格（Job 级 `image:`）—— 与上面「这台机长自哪版」是**两件事**：
   * 前者是宿主身份，后者是「这一跑哪几格换了环境」。放在同一处打，是因为它们
   * 回答的是同一个问题：**这一次跑在什么环境上**（见文件头第四件事）。 */
  const containerStages = platformImageStages(readConfig());
  lines.push(
    containerStages.length === 0
      ? `容器格（Job 级 image:）：没有 —— 每一步都跑在宿主机上`
      : `容器格（Job 级 image:）：${containerStages
          .map((s) => `${s.name} → ${s.image}`)
          .join("；")}`,
  );
  /* 上面那一行只说「哪几格换了环境」，说不出「换了环境之后**什么留下来了**」。
   * 而这一档最贵的失效形态恰恰在那一半：不挂卷 ⇒ 每一格都重下 120 MiB，
   * 不报错、只是慢。runner 那一行同理 —— 漏掉 `namespace: group` 会**静默**
   * 回落计费的平台池，而配置看起来一模一样。 */
  for (const line of describePlan(readConfig())) lines.push(line);

  if (tag.verdict === "pinned") {
    lines.push(
      `判读：镜像标签已钉版本（${tag.tag ?? "digest 形态"}）—— 「这台机长自哪一版」可追 ✓`,
    );
  } else if (tag.verdict === "floating") {
    lines.push(
      `判读：**标签不是钉死的版本**（${tag.tag ?? "没有标签"}）—— 能拉，但「哪一版」不可追：` +
        "换一次镜像就是一个没人记录过的环境（拿 `docker image inspect --format '{{index .RepoDigests 0}}'` 取 digest 钉进来）",
    );
  } else {
    lines.push(
      "判读：这台机**没有声明镜像身份**（裸装机形态，不是错误）。" +
        "要让「环境长自哪一版」可追，装机时把下面两个环境变量钉成机器级：\n" +
        "        · " +
        IMAGE_ENV +
        "=<registry>/<namespace>/<repo>:<版本标签>（**别用 latest**）\n" +
        "        · " +
        DIGEST_ENV +
        "=sha256:…（`docker image inspect --format '{{index .RepoDigests 0}}' <镜像>` 取）\n" +
        "      口径与「宿主侧怎么用起来」见 docs/standards/13-提交与-code-review.md §13.5.3.4.1。",
    );
  }
  if (
    image !== undefined &&
    image !== null &&
    String(image).trim() !== "" &&
    dig === "missing"
  ) {
    lines.push(
      `读数：声明了镜像引用却没给 digest —— 标签会被移动，digest 不会（${DIGEST_ENV} 留空）`,
    );
  } else if (dig === "malformed") {
    lines.push(
      `读数：${DIGEST_ENV} 的形态不认（要 \`sha256:\` 加 64 位十六进制）—— 拼错的 digest 比没有更容易骗人`,
    );
  }

  for (const line of lines) log(line);
  /* **恒 0**：本步没有判据面（理由见文件头）。返回值留 `0` 而不是 `undefined`，
   * 是为了让调用点（与用例）看见「这一档不退非零」是**决定**，不是漏写。 */
  return { lines, verdict: tag.verdict, digest: dig, exitCode: 0 };
}

/* 只在被直接执行时跑 —— 判「是不是直接执行」用**两侧都过 `path.resolve` 的比较**
 * （`tests/script-main-guard.test.ts` 守着这一形态；拼 `file://${argv[1]}` 在 Windows
 * 上恒不相等，于是这一段一次都不跑、退出码恒 0 且零输出）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  /* 本步要在**装依赖之前**跑（那时 `node_modules` 还没有），所以只走 `node:*`
   * —— 与 `ci-env-probe.mjs` 同口径，不起子进程、不 import 仓内模块。 */
  imageIdentity();
}
