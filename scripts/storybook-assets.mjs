#!/usr/bin/env node
// 组件工作台的开发期资源（`.storybook/assets/**`）—— 现生成，**不入库**。
//
// 为什么需要它们：注入层（`.storybook/data-sources.tsx`）的 `media` 值源要指向
// **真图片文件**。story 里现编一个 `data:` URL 看着更省事，但那两件事是错的：
//   ① 组件真正处理的是「一个 URL 可能加载失败」，`data:` URL 永远成功，
//      于是 fallback 分支没人验；
//   ② `data:` URL 里表达不了「尺寸」这件事 —— 而 `ImageViewer` / `MediaThumbnail`
//      的排版正是按自然尺寸算的（`use-image-zoom` 的「适应窗口」），
//      没有真实宽高的图等于把那段逻辑跳过。
//
// 为什么不放 `public/`：那里会随 `next build` 进 standalone 产物、再被
// `build-desktop` 内嵌进桌包（`scripts/check-standalone-contents.cjs` 的顶层白名单）。
// 组件工作台的示例资源没有任何理由跟着出厂。所以走 Storybook 自己的 staticDirs
// （声明在 `.storybook/main.ts`）。
//
// 为什么由 `storybook.mjs` 调而不是单独的 `package.json` 脚本：那是**跨平台
// 动作**（新增 `.mjs` 入口 + `package.json` 脚本 + §9.5 对照表三处同批，AGENTS
// 硬规则 12）。这里没有独立的「生成资源」诉求 —— 它只是启动前的准备步骤，
// 跟着启动走就不必多一个入口。
//
// 图是 SVG：矢量、体积可忽略、**无外部依赖**（不引字体、不引远程），
// 且宽高写在 `viewBox` 与 `width`/`height` 上 —— 正好供 `readNaturalSize` 读。
import fs from "node:fs";
import path from "node:path";

import { resolveAppPort, resolveAppPortWithSource } from "./app-port.mjs";

/** 三张尺寸差异明显的图：横向 / 纵向 / 超宽，覆盖「适应窗口」的不同折算分支。 */
const IMAGES = [
  {
    file: "sample-landscape.svg",
    width: 1280,
    height: 720,
    label: "1280 × 720",
  },
  {
    file: "sample-portrait.svg",
    width: 720,
    height: 1280,
    label: "720 × 1280",
  },
  { file: "sample-wide.svg", width: 2400, height: 600, label: "2400 × 600" },
];

/**
 * 一张「看得出尺寸」的图：网格 + 对角线 + 中央的尺寸文字。
 *
 * 刻意用**固定色值**（不引主题 token）：它是组件工作台的测试夹具，不是应用界面，
 * 而主题色棘轮（规范 03 §3.6.1）管的是 `src/**` —— 夹具跟着 token 走反而会让
 * 「明暗两态下的组件形态」这件事多一个变量。
 *
 * @param {number} width @param {number} height @param {string} label
 */
function figure(width, height, label) {
  const grid = [];
  for (let x = 0; x <= width; x += 80) {
    grid.push(
      `<line x1="${String(x)}" y1="0" x2="${String(x)}" y2="${String(height)}" stroke="#2a2a35" stroke-width="1"/>`,
    );
  }
  for (let y = 0; y <= height; y += 80) {
    grid.push(
      `<line x1="0" y1="${String(y)}" x2="${String(width)}" y2="${String(y)}" stroke="#2a2a35" stroke-width="1"/>`,
    );
  }
  const fontSize = Math.round(Math.min(width, height) / 12);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">
  <rect width="100%" height="100%" fill="#141419"/>
  ${grid.join("\n  ")}
  <line x1="0" y1="0" x2="${String(width)}" y2="${String(height)}" stroke="#8b5cf6" stroke-width="4"/>
  <line x1="${String(width)}" y1="0" x2="0" y2="${String(height)}" stroke="#f59e0b" stroke-width="4"/>
  <text x="50%" y="50%" fill="#e5e7eb" font-family="monospace" font-size="${String(fontSize)}" text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>
`;
}

/**
 * 把三张图写进目标目录（幂等：内容一样就不重写，免得每次启动都动 mtime）。
 * @param {string} outDir
 * @returns {string[]} 写出的文件绝对路径
 */
export function ensureStorybookAssets(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  /** @type {string[]} */
  const written = [];
  for (const image of IMAGES) {
    const target = path.join(outDir, image.file);
    const svg = figure(image.width, image.height, image.label);
    const current = fs.existsSync(target)
      ? fs.readFileSync(target, "utf8")
      : null;
    if (current !== svg) fs.writeFileSync(target, svg, "utf8");
    written.push(target);
  }
  return written;
}

/**
 * 把**本检出的解析链端口**写成一份 JSON，供注入层读。
 *
 * 为什么走「现生成一份数据」这条路（而不是 DefinePlugin / 环境变量）：
 *  · **环境变量到不了浏览器**：Storybook 的 webpack 把 `process.env` 换成一个
 *    白名单对象字面量（实测编出来的 bundle 里只有 `NODE_ENV` / `NODE_PATH` /
 *    `STORYBOOK` / `PUBLIC_URL`），业务变量进不去；
 *  · **DefinePlugin 要直接依赖 webpack**：它只经 `@storybook/nextjs` 传递引入，
 *    不在本仓的直接依赖里，`import "webpack"` 解析不到。
 *
 * 而应用端口**必须**是当前检出算出来的那一个：它由检出路径推导（3200~3999），
 * 写死一个值在别人的 checkout 上必然错。所以跟着启动脚本现算一次。
 *
 * **为什么是 JSON 而不是一份生成的 `.ts` 模块**（ISSUE #1409）：生成件不入库、
 * 只有跑过 `pnpm storybook` 才存在，而 `tsconfig.json` 的 include 显式列着
 * `.storybook` 那两条通配（点目录不在 glob 的默认展开范围里，不列就是 tsc 与
 * eslint 的双重盲区 —— 那条动机是对的）。「类型程序去解析一个只有跑过工作台才
 * 存在的 gitignored 文件」这件事一旦成立，没跑过的检出 `tsc --noEmit` 就必报
 * TS2307，而 tsc 正是提交门槛的 A 组 —— 拦的是从那份基线分出去的每一次提交。
 * 给 JSON 就没有「类型程序要解析的说明符」这回事：消费方（`.storybook/preview.tsx`）
 * 在 Node 侧读它，缺了就用 `.storybook/app-origin-defaults.ts` 里那份入库的缺省值。
 * **`exclude` 治不了这个病（实测）**：它只过滤 include 的 glob，拦不住「作为
 * import 目标被拉进程序」的文件。
 *
 * 用**同一个权威实现** `resolveAppPort()`（不是在这里再推一遍路径哈希 —— 第二份
 * 实现必然漂移，`.env` / 推导算法任一处改动都对不上）。
 *
 * @param {string} repoRoot
 * @param {string} outFile
 * @returns {{origin: string, source: string}}
 */
export function writeStorybookAppOrigin(repoRoot, outFile) {
  const port = resolveAppPort(repoRoot);
  const origin = `http://127.0.0.1:${String(port)}`;
  const source = resolveAppPortWithSource(repoRoot).source;
  /* 写 **JSON** 而不是 TS 模块：消费方（`.storybook/preview.tsx`）要的是一份纯数据，
     它在 Node 侧读文件、再把值交给注入层。于是类型程序里既没有要解析的说明符
     （那正是 ISSUE #1409：生成件不入库，而 `.storybook` 在 include 里，所以没跑过
     `pnpm storybook` 的检出 `tsc --noEmit` 必报 TS2307），也不依赖 webpack 怎么处理
     动态 `require`（实测会被编成 context module、运行期按 glob 找，不保证命中）。
     缺省值与字段名在 `.storybook/app-origin-defaults.ts`（入库），两侧由
     `tests/storybook-tsc-input.test.ts` 判「同一组字段」。 */
  const payload = {
    APP_DEV_PORT: port,
    APP_DEV_ORIGIN: origin,
    APP_DEV_PORT_SOURCE: source,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const current = fs.existsSync(outFile)
    ? fs.readFileSync(outFile, "utf8")
    : null;
  if (current !== body) fs.writeFileSync(outFile, body, "utf8");
  return { origin, source };
}
