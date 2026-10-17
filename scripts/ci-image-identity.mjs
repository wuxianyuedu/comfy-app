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
 * ## 第四件事（ISSUE #1993 续）：它也报「本仓的容器格是哪几格」—— 而答案是**零格**
 *
 * 这条读数最初是为了报「哪几格跑在容器里」（`.cnb.yml` 曾给 `浏览器安装` /
 * `E2E 关键流程` 各加了一行任务级 `image:`，理由是它们在等网络、不在算 CPU）。
 * **那一版被一次 70 毫秒的红判死了**（`cnb-cqk-1k550gpp2`，PR #2003 首跑）：
 *
 *     （原文）浏览器安装  error [70ms]  →  Runner does not enable Docker.
 *
 * 70ms、脚本一行都没执行 —— 也就是说「没有 docker」是**整条执行面**的，不只
 * `pipeline.docker.image` 那一层：自托管节点上没有 docker daemon，平台连「起容器」
 * 这一步都做不到，带 `image:` 的 stage **必然**红。所以本仓的形态是一档：
 * **整条宿主机直跑，一格都不写 `image:`**。
 *
 * 读数与判据都还在（`platformImageStages()` 照旧把「哪几格带 `image:`」读出来、跟着
 * 每次构建打一遍；`tests/ci-image-identity.test.ts` 把允许的名单钉成**空**）——
 * 留着它们是因为下一次「要不要给某格换环境」一定会有人再问一遍，而那时先要看到的
 * 就是这一行读数与那次 70ms 的读数，不是重新推一遍「任务级 image 应该可以吧」。
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

/** `.cnb.yml` 里本仓认得的那一档「任务级镜像」—— 宿主机没 docker 之后容器仍从这一格来。 */
const CNB_CONFIG = ".cnb.yml";

/** 镜像引用（**必须钉版本标签**，`latest` 会让「哪一版」这件事彻底不可追）。 */
export const IMAGE_ENV = "COMFYAPP_NODE_IMAGE";
/** 那一次的 digest（`sha256:…`）—— 标签可以被移动，digest 不会。 */
export const DIGEST_ENV = "COMFYAPP_NODE_IMAGE_DIGEST";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根 —— 本脚本住在 `scripts/` 下。 */
export const ROOT = path.resolve(HERE, "..");

/**
 * 从 `.cnb.yml` 原文里读出**哪几格在容器里跑**（任务级 `image:`）。
 *
 * ## 为什么这件事要有执行者（而现役答案是「一格都没有」）
 *
 * 「任务级 `image:` 在自托管上照旧能起容器」这条推论（依据是官方
 * `script-vs-plugin.md` 讲平台池的那句「指定 `image` 的脚本任务在独立容器中执行」）
 * **被一次实测否掉了**：`.cnb.yml` 里那两格各加一行 `image:` 之后，平台侧第一跑
 * 就是 `浏览器安装 error [70ms] → Runner does not enable Docker.`（`cnb-cqk-1k550gpp2`）。
 * 节点上没有 docker daemon，连起容器这一步都做不到 —— 所以本仓的真实形态是
 * **整条宿主机直跑**，判据把允许的名单钉成空。
 *
 * 解析器与这条读数保留，是因为「哪一格带了 `image:`」正是那次事故里**没人读得出来**
 * 的那件事：配置看着对、日志里只有一句 70ms 的 Docker 报错。留着它，下一次有人加
 * 一格时，这一跑就会当场把名字打出来。
 *
 * 只认两种形状，且**都只认 stage 那一层**：
 *
 *   · `  - name: X` 起的一项里，缩进 4 空格的 `image: <ref>`（脚本任务级）；
 *   · 插件任务写成 `image:` + `settings:`（同名键，形态一样）。
 *
 * 缩进判据是有意的：`.env` / `env:` 里同名键不会撞上（它们的缩进更深），而
 * `# ` 注释掉的那一行也不匹配（`^` 之后要求空格 + 非 `#`）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Array<{name: string, image: string}>} 有序，与配置里出现的顺序一致
 */
export function platformImageStages(text) {
  /* ⚠️ **不写 `^ {n}` 那一族正则**：这台机（Node 24 的 V8）在「锚 + 定长量词 +
   * 后续字面量」上会漏回溯 —— `^ {2}a` 对 `"    a"` 判 false（`^a{2}b` 对 `"aaab"`
   * 同样判 false）。本函数要判的是缩进层级，按字符计数比量词直白得多，也顺手绕开
   * 那个坑；**别为了迁就引擎去改用例的期望值**。 */
  /** @type {Array<{name: string, image: string}>} */
  const out = [];
  /** @type {{name: string, indent: number} | null} */
  let current = null;
  for (const raw of text.split("\n")) {
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    /* 列表项：`- name: X`（缩进多少层都认 —— `stages:` 可能嵌在 pipeline 里）。 */
    if (body.startsWith("- name:")) {
      current = { name: body.slice("- name:".length).trim(), indent };
      continue;
    }
    /* 回到顶层键（`master:` 等）：本项结束了。`stages:` 那一层不结束 —— 后面还有项。 */
    if (indent === 0 && body !== "") {
      current = null;
      continue;
    }
    if (current === null) continue;
    /* 项自己的键：比 `- name:` 深一层。更深的是 `env:` 里的同名键，不算。 */
    if (indent === current.indent + 2 && body.startsWith("image:")) {
      const value = body
        .slice("image:".length)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (value !== "") out.push({ name: current.name, image: value });
    }
  }
  return out;
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

  /* 本仓的容器格（任务级 `image:`）—— 与上面「这台机长自哪版」是**两件事**：
   * 前者是宿主身份，后者是「这一跑哪几格换了环境」。放在同一处打，是因为它们
   * 回答的是同一个问题：**这一次跑在什么环境上**（见文件头第四件事）。 */
  const containerStages = platformImageStages(readConfig());
  lines.push(
    containerStages.length === 0
      ? `容器格（任务级 image:）：没有 —— 每一步都跑在宿主机上`
      : `容器格（任务级 image:）：${containerStages
          .map((s) => `${s.name} → ${s.image}`)
          .join("；")}`,
  );

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
