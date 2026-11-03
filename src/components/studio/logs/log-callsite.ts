/**
 * log-callsite — 「这条 console 日志是哪里打的」的调用位置采集（纯函数）：把 `new Error().stack`
 * 的文本变成面板上那一列能读的位置，与过滤 / 时间线合并无关。从 `log-analysis` 拆出独立成叶——
 * 那一族越过文件长度硬闸的正确出口是拆模块而非抬基线（§12.6），顺带缩小「按当时文件名写死、
 * 拆文件后静默失效」的脆弱面；两层出口见 {@link locateInStack}。 */

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
 * 面板自身那一族模块的帧：栈顶永远是这些包装 / 采集函数，必须跳过。旧正则没匹配过包装层 `LogProvider.tsx`（驼峰），拆出 `log-analysis.ts` 后连采集函数自己的帧都不认，位置列因此指向日志器本身（ISSUE #1703）。
 * 判据改为「路径在 logs/ 下、且文件名以 log- 开头或叫 LogProvider」：拆文件、改后缀不再失效。 */
const LOGGER_SELF_RE = /(?:^|\/)logs\/(?:log-[\w.-]+\.(?:tsx?|jsx?)|LogProvider\.tsx?)\b/i;
/** 框架 / 编译产物的特征帧（找业务帧时跳过）。 */
const FRAMEWORK_FRAME_RE =
  /node_modules|react-dom|react\.production|react\.development|next\/(?:dist|server|client)|@tauri-apps|scheduler|webpack[/](?:runtime|bootstrap)|\[native code\]/i;
/** 项目源码以 TS 编写；dev 期只有映射回 .ts/.tsx 的帧才算「可读业务位置」。 */
const PROJECT_SOURCE_RE = /\.(?:tsx?|mts|cts)$/i;

/**
 * 解析一帧 → {@link StackFrame}；不是 `at …` 行或取不到位置段时返回 null。位置段末尾一定是
 * `:line:col`，从后往前取两个冒号；`path` 侧的协议 / 前缀清理（webpack-internal、file://、
 * `_next/static/chunks`）收在这里一处，业务帧与库帧两条出口共用同一口径。
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
    secondLastColon === -1 ? loc.slice(lastColon + 1) : loc.slice(secondLastColon + 1, lastColon);
  let path = secondLastColon === -1 ? loc.slice(0, lastColon) : loc.slice(0, secondLastColon);

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
 * 从**库帧**里取一个可读的包名（`@scope/pkg` 或 `pkg`）：取最后一个 `node_modules/` 之后的
 * 头一段（`@scope` 时拼头两段）；pnpm 的 `.pnpm` 本身不是包名，遇到就再往里找一层。取不到返回 null。
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
 * 库帧 → `pkg → 函数名`（取不到函数名时只有 `pkg`）：函数名从 `at FuncName (` 取，
 * 匿名帧只留包名。它回答「这条日志**不是我们写的**，是哪个库在哪一层打的」。
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
 * 从**给定的调用栈文本**中定位「这条日志是谁打的」；栈为空 / 解析失败 → undefined。收成吃字符串的纯函数是为了可测（React 警告的栈、pnpm 深路径在用例里造得出来）。
 * 按可信度降序：① 业务帧（`.ts/.tsx`）→ `src/…/x.tsx:123`（能直接点开）；② 库帧（`node_modules`）→ `@xyflow/react → MiniMapNodes`（ISSUE #1703 的 React key 警告）；③ 都取不到 → undefined。
 * 只认 source-map 帧当业务帧：框架输出源自压缩/哈希 chunk，对用户没有可读含义。 */
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
 * 取当前调用点的位置（栈来源 = `new Error().stack`）。解析本体是 {@link locateInStack}——拆开只为
 * 让用例能喂**造出来的栈**；`new Error()` 必须在调用点就地取，不要挪进 `locateInStack`：栈里多一层
 * 就少看见一层真实调用者。
 */
export function captureLocation(): string | undefined {
  return locateInStack(new Error().stack);
}
