#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：ComfyUI 端口口径一致性（供 .githooks/pre-commit 与 CI 调用）
/**
 * ComfyUI 端口口径一致性 —— 断言用例（ISSUE #534 P1）
 * ===========================================================================
 * 起因：`comfyuiPort: 0`（"未配置端口"）在**同一个应用里有两套解释**：
 *
 *   · 连接侧 `resolveComfyBase()`（`src/lib/comfyui/client.ts`）判 `0` 为
 *     "未配置" → 用 `COMFYUI_DEFAULT_PORT`（8188）作为**探测起点**；
 *   · 拉起侧 `resolveEffectiveLaunch()`（`src/lib/comfyui/desktop-instance.ts`）
 *     把 `0` 原样交给 `buildSpawnArgs()`，后者只在 `port > 0` 时补 `--port`
 *     → ComfyUI **以它自己的默认端口**启动。
 *
 * 也就是说："配置端口为空"并不产生矛盾，两侧都以 8188 为共同默认；真正会
 * 分叉的是"配置了非 8188 的端口"：拉起侧显式传 `--port N`，而连接侧是
 * **靠端口事实（进程表）反查**的，配置值只用于兜底探测。两者差一格的表现
 * 不是"连不上"（8188 上往往真有个别的实例在应答），而是**静默连错实例**——
 * 正是规范 §5 最忌讳的那类故障。
 *
 * 本脚本把这条契约做成**可失败的断言**（原报告的建议）：
 *   ① 默认端口是单一事实源，且两侧共用同一个常量；
 *   ② `buildSpawnArgs` 对 spawn 端口的口径（>0 才显式传）；
 *   ③ 拉起侧与连接侧对"未配置端口"给出**同一个**默认端口；
 *   ④ 静态检查：源码里不得再出现裸 `8188` 字面量（§12.14 端点收口）。
 *
 * 用法：
 *   node scripts/check-comfyui-port-contract.cjs          # 检查（pre-commit / CI）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const problems = [];
const fail = (msg) => problems.push(msg);

/** 读源码文本；不存在返回 null（用于"文件被改名/挪走"这类静默失效）。 */
function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

const CLIENT = "src/lib/comfyui/client.ts";
/* 拉起侧（buildSpawnArgs 调用 + 默认端口注入）自 ISSUE #570 起在
 * lifecycle-launch.ts；lifecycle.ts 只留「取事实 → 判决 → 交付」。 */
const LIFECYCLE = "src/lib/comfyui/lifecycle-launch.ts";
const DERIVE = "src/lib/comfyui/lifecycle-derive.ts";
const DESKTOP = "src/lib/comfyui/desktop-instance.ts";
/* 设置的**纯部分**（类型 / 默认值 / 派生）。自 ISSUE #569 第 5 项起原
 * `src/lib/app-settings.ts` 拆成目录：纯部分在 `app-settings/index.ts`，
 * fs 部分在 `app-settings/app-settings.server.ts`。 */
const SETTINGS_PURE = "src/lib/app-settings/index.ts";
const SETTINGS_IO = "src/lib/app-settings/app-settings.server.ts";
const ENDPOINTS = "src/lib/endpoints.ts";

/* ── ① 默认端口的单一事实源 ───────────────────────────────────────────── */

/* 常量定义在 endpoints.ts（**零依赖**层）：它要同时被设置页视图（浏览器图）、
 * 服务端与拉起侧读取，而 app-settings.ts 顶层 import fs —— 走那条路会让设置有
 * 默认端口的页面整页 500（ISSUE #282/#317）。app-settings.ts 只**再导出**同名。 */
const endpointsSrc = read(ENDPOINTS);
if (endpointsSrc == null) fail(`找不到 ${ENDPOINTS}`);
const decl =
  endpointsSrc &&
  /export\s+const\s+COMFYUI_DEFAULT_PORT\s*=\s*(\d+)\s*;/.exec(endpointsSrc);
if (!decl) {
  fail(
    `${ENDPOINTS} 里找不到 \`export const COMFYUI_DEFAULT_PORT = <数字>;\` —— ` +
      `默认端口必须在**零依赖**的常量层单点定义（否则浏览器图一 import 就整页 500）`,
  );
}
const defaultPort = decl ? Number(decl[1]) : null;

/* app-settings 目录**不得再转手**默认端口（转手正是历史事故的诱因：视图层为了
 * 一个常量而 import 到一个顶层带 fs 的文件，浏览器图整页 500）。
 * 需要默认端口的地方直接引 `@/lib/endpoints`；这里改成「反向」断言。 */
const settingsPureSrc = read(SETTINGS_PURE);
const settingsIoSrc = read(SETTINGS_IO);
if (settingsPureSrc == null) {
  fail(`找不到 ${SETTINGS_PURE}`);
}
if (settingsIoSrc == null) {
  fail(`找不到 ${SETTINGS_IO}`);
}
for (const [file, src] of [
  [SETTINGS_PURE, settingsPureSrc],
  [SETTINGS_IO, settingsIoSrc],
]) {
  if (src == null) continue;
  if (
    /export\s+const\s+COMFYUI_DEFAULT_PORT\s*=/.test(src) ||
    /export\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from/.test(src)
  ) {
    fail(
      `${file} 不得定义或再导出 \`COMFYUI_DEFAULT_PORT\` —— 默认端口的唯一出口是 ` +
        `${ENDPOINTS}（零依赖常量层）。转手会让「只想要一个常量」的视图层拖进 fs`,
    );
  }
}

/* ── ② 拉起侧：spawn 参数对端口的口径 ───────────────────────────────────── */

const deriveSrc = read(DERIVE);
if (deriveSrc == null) fail(`找不到 ${DERIVE}`);
else {
  // buildSpawnArgs 必须"只在有效端口与默认端口不同时"才补 --port。
  const fnAt = deriveSrc.indexOf("export function buildSpawnArgs");
  if (fnAt < 0) {
    fail(`${DERIVE} 里找不到 buildSpawnArgs —— 拉起侧端口口径的判据点被改名/挪走`);
  } else {
    const body = deriveSrc.slice(fnAt, fnAt + 1400);
    if (!/facts\.effectivePort\s*&&\s*facts\.effectivePort\s*>\s*0/.test(body)) {
      fail(
        `buildSpawnArgs 不再用「effectivePort > 0」判「配置了端口」——` +
          `「0 = 未配置」这条契约被改掉了，连接侧的兜底默认值必须同步核对`,
      );
    }
    if (!/port\s*!==\s*facts\.defaultPort/.test(body)) {
      fail(
        `buildSpawnArgs 不再按「有效端口 ≠ 默认端口」决定是否补 --port ——` +
          `改为无条件补 --port 会污染日志与「界面显示端口 = 实际监听端口」的对照关系`,
      );
    }
    if (!/facts\.defaultPort/.test(body)) {
      fail(`buildSpawnArgs 不再接收 defaultPort —— 默认端口必须由调用方注入同一个常量`);
    }
  }
}

const lifecycleSrc = read(LIFECYCLE);
if (lifecycleSrc == null) fail(`找不到 ${LIFECYCLE}`);
else if (!/buildSpawnArgs\(\{[\s\S]{0,400}?defaultPort:\s*COMFYUI_DEFAULT_PORT/.test(lifecycleSrc)) {
  fail(
    `${LIFECYCLE} 的 buildSpawnArgs 调用不再注入 defaultPort: COMFYUI_DEFAULT_PORT —— ` +
      `注入别的值（或各自写死）会让「拉起端口」与「连接端口」各有一套默认值`,
  );
}
/* 模块路径自 ISSUE #569 第 5 项起是 `../app-settings/app-settings.server`（原
 * 单文件拆成目录后 IO 部分带 `.server.ts` 后缀）；断言的是「从应用设置那一侧取」，
 * 不把具体的中间路径写死 —— 写死会让一次目录调整变成门禁的红灯。 */
if (lifecycleSrc && !/import\s*\{[\s\S]*?COMFYUI_DEFAULT_PORT[\s\S]*?\}\s*from\s*"\.\.\/endpoints"/.test(lifecycleSrc)) {
  fail(`${LIFECYCLE} 不再从 ../endpoints 导入 COMFYUI_DEFAULT_PORT —— 默认端口必须共用同一常量`);
}

/* ── ③ 拉起侧与连接侧对「未配置端口」给同一个默认值 ─────────────────────── */

const clientSrc = read(CLIENT);
if (clientSrc == null) fail(`找不到 ${CLIENT}`);
/* 连接侧与拉起侧自 ISSUE #569 第 5 项起都**直接从零依赖常量层**取默认端口
 * （app-settings 拆成目录后不再转手它：转手会让「只想要一个常量」的视图层
 * 拖进 fs）。断言的是「两侧取的是同一个常量」这件事本身，路径跟着唯一出口走。 */
else if (!/import\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from\s*"\.\.\/endpoints"/.test(clientSrc)) {
  fail(
    `${CLIENT} 不再从 ../endpoints 导入 COMFYUI_DEFAULT_PORT —— ` +
      `连接侧的「未配置端口」兜底值必须与拉起侧同一个常量（曾经硬编码 8188，两处从未对过）`,
  );
}

const desktopSrc = read(DESKTOP);
if (desktopSrc == null) fail(`找不到 ${DESKTOP}`);

/* ── ④ 默认地址拼装收口到 endpoints.ts（§12.14） ───────────────────────── */

if (!endpointsSrc) {
  /* 已在上面报过缺失，这里不重复报 */
} else if (!/export\s+function\s+comfyUiBaseUrl\s*\(/.test(endpointsSrc)) {
  fail(`${ENDPOINTS} 的 comfyUiBaseUrl 不见了 —— 本机服务地址必须单点拼装`);
}

/* ── ⑤ 源码里不得再出现裸 `8188` 字面量（默认端口走常量） ───────────────── */

/** 扫 src/**，命中裸 8188 即报。豁免：注释（解释历史/文档口径）、
 *  `COMFYUI_DEFAULT_PORT` 的定义行本身（它就是那个数字）。 */
function collectSourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__snapshots__") continue;
      collectSourceFiles(abs, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

const rawPortHits = [];
for (const abs of collectSourceFiles(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (!/8188/.test(line)) return;
    const trimmed = line.trim();
    // 注释行不算（解释历史口径是允许的）
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    // 定义默认端口的那一行不算（它就是数字本身）
    if (/COMFYUI_DEFAULT_PORT\s*=\s*8188/.test(line)) return;
    // 反引号里作为"文档示例"出现在字符串中的地址（如错误文案里举的 :8188）
    rawPortHits.push(`${rel}:${idx + 1}  ${trimmed.slice(0, 120)}`);
  });
}
if (rawPortHits.length > 0) {
  fail(
    `源码里出现裸 8188 字面量（默认端口必须走 COMFYUI_DEFAULT_PORT，规范 §12.14）：\n  ` +
      rawPortHits.slice(0, 10).join("\n  ") +
      (rawPortHits.length > 10 ? `\n  …（其余 ${rawPortHits.length - 10} 处省略）` : ""),
  );
}

/* ── 输出 ─────────────────────────────────────────────────────────────── */

if (problems.length === 0) {
  console.log(
    `[comfyui-port] ✓ 端口口径一致（默认端口 ${defaultPort}：连接侧与拉起侧共用同一常量，` +
      `源码无裸 8188 字面量）`,
  );
  process.exit(0);
}

console.error("[comfyui-port] ComfyUI 端口口径不一致（规范 §5 / §12.14，ISSUE #534）：");
for (const p of problems) console.error(`  · ${p}`);
console.error(
  "\n「配置端口为空」两侧都以默认端口为准；出现分叉时用户读到的是上传失败 / 端口漂移，" +
    "根因（连到了另一个实例）被现象埋掉。修法见 scripts/check-comfyui-port-contract.cjs 头注释。",
);
process.exit(1);
