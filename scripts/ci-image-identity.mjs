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

/** 镜像引用（**必须钉版本标签**，`latest` 会让「哪一版」这件事彻底不可追）。 */
export const IMAGE_ENV = "COMFYAPP_NODE_IMAGE";
/** 那一次的 digest（`sha256:…`）—— 标签可以被移动，digest 不会。 */
export const DIGEST_ENV = "COMFYAPP_NODE_IMAGE_DIGEST";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根 —— 本脚本住在 `scripts/` 下。 */
export const ROOT = path.resolve(HERE, "..");

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
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {{lines: string[], verdict: "pinned" | "floating" | "missing",
 *            digest: "ok" | "malformed" | "missing", exitCode: 0}}
 */
export function imageIdentity({
  env = process.env,
  osReleaseImpl = () => osRelease(),
  kernelImpl = () => `${os.type()} ${os.release()}`,
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
