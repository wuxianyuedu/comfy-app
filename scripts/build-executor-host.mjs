#!/usr/bin/env node
// @ts-nocheck -- build-time script: runs outside the Next module graph
/**
 * 把执行器宿主的运行时图预编译进 standalone / 桌包产物。
 *
 * 为什么要这一件事（P3 §5 ADR §13 / ISSUE #1169，切法 3-E1）：
 * `scripts/executor-host.mjs` 原先用 `tsx` 把整张运行时图当 TypeScript 源加载。
 * `tsx` 是 devDependency，而产物只带生产依赖，所以打包之后的
 * `COMFY_EXECUTOR=host` 在 boot 时大声失败（"Cannot find package 'tsx'"）。
 * 为了一个灰度开关把 tsx（以及它驱动的那份平台专属二进制）装进分发给使用者的
 * 应用是笔坏交易；预编译成一份 ESM 实测约 1.4 MB（306 个输入），换来 devDependency
 * 从运行期路径上被彻底摘掉。
 *
 * 产出（写进 standalone 根，也就是 `server.js` 所在的那一层）：
 *   scripts/executor-host.runtime.mjs  打包后的运行时图
 *   scripts/executor-host.build.json   机器写的构建清单：inputs + externals
 *
 * 宿主入口在两种形态下都保持**源码**，并按内容决定加载哪份图（我旁边有没有那份
 * 预编译件？）——见 `scripts/executor-host.mjs` 里的 `RUNTIME_BUNDLE`。所以缺预编译件
 * 只会退回 tsx 分支然后大声失败，不会半接线地跑起来；更早抓住它的是构建期冒烟
 * （`scripts/smoke-executor-host-standalone.mjs`）。
 *
 * 两处**动手前必须先知道**的取舍：
 *   1. 没有用 `packages: "external"`。只列那三个必须留在外面的包（带原生/可选绑定，
 *      或与服务端共享的进程级单例）；纯 JS 的（drizzle-orm、zod、
 *      @paralleldrive/cuid2）打进来——裁剪版 node_modules 顶层根本没有它们
 *      （Next 把这几个编进了 server chunk）。
 *   2. `server-only` 解析成内存里的一句 throw，而不是列进 external。有些模块只能经
 *      入口的「动态 import + catch」兜底才被摸到（Next 侧的那些 barrel），它们静态
 *      import 了这个包；作为 external 它会被 ESM 提升到 bundle 顶部、加载即抛，
 *      恰好破坏「没被问到就不要加载」这条 lazy 边界。做成 bundle 内的桩则保持 lazy，
 *      throw 文案与包自己的契约一致。
 *
 * 报错文案保持 ASCII 英文（规范 §9.5：构建期脚本的错误出口用 `[ERROR] …` 短句，
 * 中文说明放文档）。
 *
 * 用法：node scripts/build-executor-host.mjs [targetDir]
 *   targetDir 缺省为 .next/standalone
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGET = path.join(ROOT, ".next", "standalone");
const RUNTIME_ENTRY = path.join(
  ROOT,
  "src",
  "lib",
  "comfyui",
  "host-runtime.ts",
);
const BUNDLE_REL = path.join("scripts", "executor-host.runtime.mjs");
const MANIFEST_REL = path.join("scripts", "executor-host.build.json");

/** 必须留在外面的包：@libsql/client 带平台绑定，ws/pino 有可选加速原生模块，还有
 *  与服务端共享的进程级单例。三份都已被 Next 的 tracing 带进产物（由清单核对）。 */
const EXTERNAL_PACKAGES = [
  "@libsql/client",
  "@libsql/client/node",
  "ws",
  "pino",
];

const SERVER_ONLY_STUB =
  'throw new Error("server-only: this module cannot be imported outside the Next server graph");\n';

const require = createRequire(import.meta.url);

/** esbuild 现在是直接的 devDependency（pnpm-workspace.yaml 的 allowBuilds 早就批过它）。
 *  延迟加载是为了让「装不上」这种失败给出可读的那一句。 */
function loadEsbuild() {
  try {
    return require("esbuild");
  } catch (err) {
    console.error(
      "[ERROR] esbuild is not resolvable from this script. Run `pnpm install` " +
        "(esbuild is a devDependency used only at build time; it must NOT be a " +
        `production dependency). Underlying error: ${err?.message ?? err}`,
    );
    process.exit(1);
  }
}

/**
 * 把宿主的运行时图打包进 `targetDir`。
 *
 * @param {string} targetDir 已经含有 server.js 的产物根
 * @returns {Promise<{ bundlePath: string, manifestPath: string, inputs: string[],
 *                     externals: string[], bytes: number }>}
 */
export async function buildExecutorHostBundle(targetDir = DEFAULT_TARGET) {
  const esbuild = loadEsbuild();
  const serverJs = path.join(targetDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `target artifact root has no server.js: ${serverJs}. Run \`pnpm build\` ` +
        "(next build) first - this script only adds the host runtime bundle.",
    );
  }
  if (!fs.existsSync(RUNTIME_ENTRY)) {
    throw new Error(`runtime graph entry missing: ${RUNTIME_ENTRY}`);
  }

  const outfile = path.join(targetDir, BUNDLE_REL);
  const result = await esbuild.build({
    entryPoints: [RUNTIME_ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    minify: false,
    // 保留函数/类名：产物的堆栈里还能读出 `reapStaleUnownedQueued`，而不是 `n`。
    keepNames: true,
    sourcemap: false,
    legalComments: "none",
    metafile: true,
    external: [...EXTERNAL_PACKAGES, "node:*"],
    banner: {
      js: [
        // 被包进来的 CJS（pino / drizzle 内部）运行期仍会走 require()。esbuild 的 ESM
        // 兜底要求作用域里有一个 require，缺了它，产物里的宿主就死在
        // `Dynamic require of "node:crypto" is not supported`——这一条只有真起进程的
        // 冒烟抓得到（scripts/smoke-executor-host-standalone.mjs），类型与单测都碰不到。
        'import { createRequire as __comfyCreateRequire } from "node:module";',
        "const require = __comfyCreateRequire(import.meta.url);",
        "/* GENERATED at build time by scripts/build-executor-host.mjs.",
        " * Source graph: src/lib/comfyui/host-runtime.ts (P3 section 5, ISSUE #1169).",
        " * Do not edit; do not expect a TypeScript loader here. */",
      ].join("\n"),
    },
    plugins: [
      {
        name: "server-only-lazy-stub",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "server-only-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "server-only-stub" }, () => ({
            contents: SERVER_ONLY_STUB,
            loader: "js",
          }));
        },
      },
    ],
  });

  const output = Object.values(result.metafile.outputs)[0];
  const inputs = Object.keys(result.metafile.inputs).sort();
  const externals = [
    ...new Set(
      [...(output?.imports ?? [])]
        .filter(
          (i) => i.kind === "import-statement" || i.kind === "dynamic-import",
        )
        .map((i) => i.path)
        .filter((p) => !p.startsWith("node:")),
    ),
  ].sort();
  const bytes = output?.bytes ?? fs.statSync(outfile).size;

  const manifest = {
    generatedBy: "scripts/build-executor-host.mjs",
    entry: path.relative(ROOT, RUNTIME_ENTRY).split(path.sep).join("/"),
    outputs: path.relative(targetDir, outfile).split(path.sep).join("/"),
    inputs,
    externals,
    bytes,
    targetDir: path.relative(ROOT, targetDir).split(path.sep).join("/") || ".",
  };
  fs.mkdirSync(path.dirname(path.join(targetDir, MANIFEST_REL)), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(targetDir, MANIFEST_REL),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  return {
    bundlePath: outfile,
    manifestPath: path.join(targetDir, MANIFEST_REL),
    inputs,
    externals,
    bytes,
  };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const target = process.argv[2]
    ? path.resolve(ROOT, process.argv[2])
    : DEFAULT_TARGET;
  try {
    const built = await buildExecutorHostBundle(target);
    console.log(
      `[executor-host-bundle] OK inputs=${built.inputs.length} ` +
        `externals=${built.externals.join(",") || "-"} ` +
        `bytes=${built.bytes} -> ${path.relative(ROOT, built.bundlePath)}`,
    );
  } catch (err) {
    console.error(`[ERROR] ${err?.stack ?? err}`);
    process.exit(1);
  }
}
