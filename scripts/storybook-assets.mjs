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
 * 把**本检出的解析链端口**写成一个 TypeScript 常量模块，供注入层读。
 *
 * 为什么走「现生成一个源文件」这条路（而不是 DefinePlugin / 环境变量）：
 *  · **环境变量到不了浏览器**：Storybook 的 webpack 把 `process.env` 换成一个
 *    白名单对象字面量（实测编出来的 bundle 里只有 `NODE_ENV` / `NODE_PATH` /
 *    `STORYBOOK` / `PUBLIC_URL`），业务变量进不去；
 *  · **DefinePlugin 要直接依赖 webpack**：它只经 `@storybook/nextjs` 传递引入，
 *    不在本仓的直接依赖里，`import "webpack"` 解析不到。
 *
 * 而应用端口**必须**是当前检出算出来的那一个：它由检出路径推导（3200~3999），
 * 写死一个值在别人的 checkout 上必然错。所以跟着启动脚本现算一次。
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
  /* `source` 是 app-port.mjs 的词表（env / derived / fallback）—— 翻成一句人话，
     画布上那条提示才读得懂。 */
  const sourceLabel = {
    env: ".env 里的 COMFYAPP_PORT",
    derived: "按检出路径推导",
    fallback: "缺省兜底值",
  }[source];
  const body = [
    "// 本文件由 scripts/storybook-assets.mjs 现生成，**不入库**（见 .gitignore）。",
    "// 改端口来源请改 scripts/app-port.mjs（权威实现），不要改这里。",
    "//",
    "// 这是**本检出**的解析链端口：应用的端口按检出路径推导（3200~3999），",
    "// 不同 checkout 不同，所以它必须在启动工作台时现算一次。",
    "",
    `/** 解析链端口（应用实际监听的端口）。来源：${sourceLabel ?? source}。 */`,
    `export const APP_DEV_PORT = ${String(port)};`,
    "",
    "/** 真 tRPC 链路指向的应用 origin。 */",
    `export const APP_DEV_ORIGIN = ${JSON.stringify(origin)};`,
    "",
    "/** 上面那个值是怎么来的（`env` / `derived` / `fallback`，词表见 app-port.mjs）。 */",
    `export const APP_DEV_PORT_SOURCE = ${JSON.stringify(source)};`,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const current = fs.existsSync(outFile)
    ? fs.readFileSync(outFile, "utf8")
    : null;
  if (current !== body) fs.writeFileSync(outFile, body, "utf8");
  return { origin, source };
}
