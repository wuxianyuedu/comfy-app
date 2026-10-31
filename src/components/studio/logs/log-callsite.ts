/**
 * log-callsite — 「这条 console 日志是哪里打的」的调用位置采集（纯函数）。
 *
 * 只做一件事：把 `new Error().stack` 的文本变成面板上那一列能读的位置。它与
 * 「过滤什么」「怎么合并时间线」没有关系，从 `log-analysis` 里拆出来独立成叶。
 * （那是「占位符展开 + 解析 + 过滤 + 合并」一族纯函数的合住地，采集链上的东西
 * 都往那儿挂，于是它一直是最先撞文件长度硬闸的那个。）
 *
 * 独立的理由：加完「库帧退路」之后 `log-analysis.ts` 越过了文件长度硬闸，而那一闸
 * 的正确出口是**拆模块**、不是抬基线（§12.6）。顺便把「按当时的文件名写死判据、
 * 拆文件后就静默失效」那一类脆弱点收进一个更小的面里。
 *
 * 两层出口（细节见 {@link locateInStack} 的注释），位置与「库帧怎么说」的文案都
 * 在这里，`LogRow` 只看 `" → "` 这个标记区分两态。
 *
 * @module logs/log-callsite
 */

/** 一帧调用栈解析出的位置（`path` 已剥协议前缀，`lineNo` 仅数字时保留）。 */
type StackFrame = {
  /** 行号（非数字时为空串）。 */
  lineNo: string;
  /** 位置段解析出的路径（已做前缀清理）。 */
  path: string;
  /** 原始行（判 `node_modules` / 框架特征时看它）。 */
  raw: string;
};

/**
 * 面板自身那一族模块的帧：栈顶永远是这些包装 / 采集函数，必须跳过。
 *
 * **按目录 + 文件名两段判、且大小写不敏感**（ISSUE #1703）。旧写法是
 * `/log-(?:store|provider)\.(tsx|ts|jsx|js)/`，它从来没匹配过真正的包装层
 * `LogProvider.tsx`（无连字符、驼峰），只匹配到了 `captureLocation` 当年所在的
 * `log-store.ts`。那个文件被拆出 `log-analysis.ts` 之后，这条正则连采集函数自己
 * 的帧都不认了 —— 于是**每条 console 日志的位置列都指向 `log-analysis.ts:<行号>`**，
 * 也就是日志器本身：用户拿着「有位置」的行去找，找到的是打印日志的那段代码。
 *
 * 判据改成「路径在 logs/ 目录下、且文件名以 log- 开头或叫 LogProvider」：
 * 拆文件、改后缀都不会再让它失效（这类「按当时的文件名写死」的判据，失效方式是
 * 静默给出**看似有效**的错答案，比返回空更难发现）。
 */
const LOGGER_SELF_RE = /(?:^|\/)logs\/(?:log-[\w.-]+\.(?:tsx?|jsx?)|LogProvider\.tsx?)\b/i;
/** 框架 / 编译产物的特征帧（找业务帧时跳过）。 */
const FRAMEWORK_FRAME_RE =
  /node_modules|react-dom|react\.production|react\.development|next\/(?:dist|server|client)|@tauri-apps|scheduler|webpack[/](?:runtime|bootstrap)|\[native code\]/i;
/** 项目源码以 TS 编写；dev 期只有映射回 .ts/.tsx 的帧才算「可读业务位置」。 */
const PROJECT_SOURCE_RE = /\.(?:tsx?|mts|cts)$/i;

/**
 * 解析一帧 → {@link StackFrame}；不是 `at …` 行或取不到位置段时返回 null。
 *
 * 位置段末尾一定是 `:line:col`，从后往前取两个冒号即可；`path` 侧的协议 / 前缀
 * 清理（webpack-internal、file://、`_next/static/chunks`）都收在这里一处 ——
 * 业务帧与库帧两条出口共用同一份口径，否则「哪个帧更可读」的比较没有共同基准。
 */
function parseStackFrame(raw: string): StackFrame | null {
  const line = raw.trim();
  if (!line.startsWith("at ")) {
    return null;
  }
  if (LOGGER_SELF_RE.test(line)) {
    return null;
  }

  // 取 frame 中的位置部分：优先用最后一个 (...) 里的内容，否则取整行
  const parenMatch = /\(([^)]+)\)\s*$/.exec(line);
  const loc = parenMatch ? parenMatch[1] : line.replace(/^at\s+/, "");
  if (!loc) {
    return null;
  }

  // 位置段末尾一定是 :line:col，取最后两个冒号分割
  const lastColon = loc.lastIndexOf(":");
  if (lastColon <= 0) {
    return null;
  }
  const secondLastColon = loc.lastIndexOf(":", lastColon - 1);
  const lineNo =
    secondLastColon >= 0 ? loc.slice(secondLastColon + 1, lastColon) : loc.slice(lastColon + 1);
  let path = secondLastColon >= 0 ? loc.slice(0, secondLastColon) : loc.slice(0, lastColon);

  // 清理常见前缀 / 协议
  path = path.replace(/^webpack-internal:\/\/\/\.\//, "");
  path = path.replace(/^webpack-internal:\/+/i, "");
  path = path.replace(/^file:\/\/\//, "");
  path = path.replace(/^https?:\/\/[^/]+\/_next\/static\/chunks\//, "");
  path = path.replace(/^https?:\/\/[^/]+\//, "");

  // Turbopack / 某些 webpack source-map 配置会把模块路径里的 "/" 编码为 "_"，
  // 形成 "src_components_studio_15hhqk_logs_log-store.ts" 这种标识符。
  // 在肉眼可读性层面把它还原（heuristic：以 src_ 开头且没有 "/"）。
  if (!path.includes("/") && path.startsWith("src_")) {
    path = path.replaceAll("_", "/");
  }

  // 取 /src/ 之后的路径作为最简可读形式
  const srcIdx = path.indexOf("/src/");
  if (srcIdx !== -1) {
    path = path.slice(srcIdx + 1);
  }

  return { raw: line, path, lineNo };
}

/**
 * 从**库帧**里取一个可读的包名（`@scope/pkg` 或 `pkg`）。
 *
 * 落在 `node_modules` 里的帧长这样：
 *   …/node_modules/react-dom/cjs/react-dom-client.development.js
 *   …/node_modules/.pnpm/@xyflow+react@12.12.0_x/node_modules/@xyflow/react/dist/esm/index.mjs
 * 取**最后一个** `node_modules/` 之后的头一段（`@scope` 时把头两段拼起来）即可。
 * pnpm 的 `.pnpm` 那一段本身不是包名，遇到就再往里找一层。取不到返回 null。
 */
function libraryNameOf(raw: string): string | null {
  const idx = raw.lastIndexOf("node_modules/");
  if (idx === -1) {
    return null;
  }
  const rest = raw.slice(idx + "node_modules/".length);
  const segs = rest.split("/");
  const first = segs[0] ?? "";
  if (first === "") {
    return null;
  }
  if (first.startsWith(".pnpm")) {
    /* `.pnpm/<pkg>@<ver>…/node_modules/<pkg>/…`：重来一次，从这一段之后再取。 */
    const inner = rest.indexOf("node_modules/");
    if (inner === -1) {
      return null;
    }
    return libraryNameOf(rest.slice(inner));
  }
  if (first.startsWith("@")) {
    return segs[1] ? `${first}/${segs[1]}` : first;
  }
  return first;
}

/**
 * 库帧 → `pkg → 函数名`（取不到函数名时只有 `pkg`）。
 *
 * 函数名从 `at FuncName (` 那一段取；匿名帧 / 取不到就只留包名。这一条回答的是
 * 「这条日志**不是我们写的**，是哪个库在哪一层打的」——没有它，用户看到的是一列
 * 没有位置列的行。
 */
function describeLibraryFrame(frame: StackFrame): string | null {
  const pkg = libraryNameOf(frame.raw);
  if (!pkg) {
    return null;
  }
  const fn = /\bat\s+([^\s(]+)\s*\(/.exec(frame.raw)?.[1];
  const clean = fn && fn !== "" ? fn : undefined;
  return clean ? `${pkg} → ${clean}` : pkg;
}

/**
 * 从**给定的调用栈文本**中定位「这条日志是谁打的」；栈为空 / 解析失败 → undefined。
 *
 * 收成「吃字符串」的纯函数（而不是就地 `new Error()`）是为了可测：React 警告
 * 的栈、pnpm 的 `.pnpm` 深路径这些形态在用例里造得出来，真跑一遍却造不出来。
 *
 * 两层出口，按可信度降序取第一个命中的：
 *   1. **业务帧**（`.ts/.tsx`）→ `src/…/x.tsx:123`。最有用：能直接点开。
 *   2. **库帧**（`node_modules`）→ `@xyflow/react → MiniMapNodes`。业务帧一个
 *      都没有时（典型：React 自己发的警告、第三方回调里的问题）**退回这一层**，
 *      而不是返回 undefined —— ISSUE #1703 里那条 React key 警告正属此类：整列
 *      没有位置，用户凭日志分不清是 MiniMap 还是自己的节点树在重 key。
 *   3. 都取不到 → undefined（行上不出现位置列）。
 *
 * **只认 source-map 帧当业务帧**的原因：Next/webpack/Turbopack 在 dev 期把用户
 * 代码 source-map 到 `.tsx/.ts`；而框架自身的 console 输出来自被压缩/哈希的编译
 * chunk（形如 `src/00vplg9./.js:1879`），这类位置对用户没有可读含义 —— 它们既不
 * 是业务代码，也不指向任何能点开的东西，只配落进第 2 层（说出是哪个库）。
 */
export function locateInStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined;
  }
  try {
    const frames = stack
      .split("\n")
      .map(parseStackFrame)
      .filter((f): f is StackFrame => f !== null);

    /* 第 1 层：业务帧。原先的两遍扫描（先跳框架、再全收）收成一遍 —— 判据是
     * 「这个帧像不像业务源码」，与「第几遍」无关。 */
    for (const frame of frames) {
      if (FRAMEWORK_FRAME_RE.test(frame.raw)) {
        continue;
      }
      if (
        frame.path &&
        PROJECT_SOURCE_RE.test(frame.path) &&
        /^\d+$/.test(frame.lineNo) &&
        !/^\d+$/.test(frame.path)
      ) {
        return `${frame.path}:${frame.lineNo}`;
      }
    }

    /* 第 2 层：库帧。取**第一个**落在 node_modules 里的帧 —— 它离调用点最近，
     * 也就是真正打印这条日志的那一层。 */
    for (const frame of frames) {
      if (!frame.raw.includes("node_modules")) {
        continue;
      }
      const described = describeLibraryFrame(frame);
      if (described) {
        return described;
      }
    }
  } catch {
    // 解析失败不应影响日志记录
  }
  return undefined;
}

/**
 * 取当前调用点的位置（栈来源 = `new Error().stack`）。
 *
 * 解析本体是上面的 {@link locateInStack} —— 拆开只为一件事：那份逻辑要能被
 * 用例直接喂**造出来的栈**（React 警告、pnpm 深路径这些形态没法在测试里真造
 * 出来）。`new Error()` 在调用点就地取，不要挪进 `locateInStack`：栈里多一层
 * 就少看见一层真实调用者。
 */
export function captureLocation(): string | undefined {
  return locateInStack(new Error().stack);
}
