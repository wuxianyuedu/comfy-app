/**
 * 「把那一件浏览器包**真拉下来**」那一层 —— 与 `playwright install` 并存，不是它的替代。
 *
 * ## 它修的那一格：链路能回响应头、能走前几 KB，却走不完 114 MiB 的大 body
 *
 * `浏览器安装` 这一步在自托管节点上红了**七跑**，形态逐字相同：
 *
 *     （探测读数）…/chrome-headless-shell-win64.zip → HTTP 206（实收 15436 字节）
 *     （真实下载）Downloading … from 同一个 URL …… 然后 timed out after 120000ms
 *
 * 前几笔把这条缝一路收窄到「探测与装之间没有执行者」「HEAD 会把取不下字节的链路判成
 * 好链路」，`pickPlaywrightRoots()` 也接上了 —— 可是那一跑里**三个候选根全部量得到**
 * （206、实收几千字节），挑根没有更好的根可挑，于是它照旧去试配着的那个根，照旧红。
 *
 * 根因不在「挑哪个根」上，在**Playwright 自己那份下载没有续传**：它的
 * `downloadBrowserWithProgressBar()` 每个 URL 重试 `retryCount = 5` 次，
 * 而**每次重试都从第 0 字节重新开始**（`browserFetcher.ts`：失败后
 * `unlink(zipPath)` + `removeFolders([browserDirectory])`）。于是一条「能握上手、
 * 能吐前几 KB、然后在大 body 上停住」的链路，无论重试多少次、换多少个根，
 * 都永远走不到 114 MiB 的尽头 —— 每一次都白花一遍 `socketTimeout`。
 *
 * ## 修法：分片取字节，每片都是**一次独立**的请求
 *
 * 实测这台节点的链路对**小响应**是好的（探测 206、实收 15 KB；本机对同一 CDN 拉完整包
 * 只要 16s），而它符合 HTTP `Range` 语义（实测任意偏移都回 `206` + `content-range`）。
 * 所以把整个包切成固定大小的片、**逐片**请求，每片带**自己的**超时与重试：
 *
 *   · 某一片超时 ⇒ 重试**那一片**，前面已落盘的部分**一个字都不重下**；
 *   · 链路整体慢 ⇒ 只是多几轮，不改变「能不能走完」这件事；
 *   · 与 Playwright 那条路的差别正在这一点上：它失败一次就把整包扔了。
 *
 * 这与本仓对「读取数」那条口径同源（§13.5.3.5.1）：「多久放弃」不是判据，
 * 「字节能不能流完」才是。分片把一个**不确定长短**的大传输换成**一串有界的**传输。
 *
 * ## 为什么它不是「又一套下载器」（与 Playwright 的分工）
 *
 * 它**不替代** `playwright install`，是它前面的一次尝试：
 *
 *   · 走到这一步的前提本来就有一半已经在了 —— `playwrightOnly()` 先按落点判
 *     `browserExecutableExists()`，东西齐了直接跳过（那一支与本节无关）；
 *   · 本模块成功 ⇒ 把 zip 解到落点并写好 `INSTALLATION_COMPLETE` 标记，
 *     于是 `playwright install` 变成 `already downloaded` 的 no-op；
 *   · 本模块失败 ⇒ 一个字都不改，交给 Playwright 的老路（它仍会按
 *     `pickPlaywrightRoots()` 排的序试、仍会给那两份读数）。
 *
 * 换句话说：**它只是把「这一件二进制怎么到手」多给一条路**，放行那条判据仍是
 * `browserExecutableExists()`（按落点看东西在不在）—— 与 `--playwright-only`
 * 原来的复验是同一条，没有第二个判据。
 *
 * ## 约束与兄弟文件逐字相同：只 import `node:*`，不 import 仓库内任何模块
 *
 * 理由见 `ci-toolchain-browser.mjs` 的文件头（这一步跑在「Node 模块链还没被证明
 * 可用」的机器上，模块加载崩掉时真正要回答的事一个都答不了）。
 *
 * ## 分片为什么走**子进程**
 *
 * 与 `httpDownloadProbe()` 同一个理由：本层要在**同步**的退出码路径里给出结论
 * （`playwrightOnly()` 立刻返回）而 `node:http(s)` 是回调式。每一片起一个短命
 * 子进程，接口就是「起一次、拿到它读了多少字节」—— 失败是一片的事，不是整包的事。
 * 子进程按 `fs.openSync(dest, "a")` **追加**写，所以前面已落盘的部分一个字都不用重下。
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * 一片默认取多大（字节）。
 *
 * 4 MiB 是「够大、不把片数堆到几千」与「够小、一片真能在一轮里走完」之间的折中：
 * 本机对同一 CDN 量到 ~6.4 MiB/s，所以一片约 0.6s；而在现场那条链路上，
 * 一片的代价上限就是 `chunkTimeoutMs`（下面那个数）—— 单片的**最坏代价是有界的**，
 * 这正是把它切开的意义。整包 114 MiB ⇒ 约 29 片。
 */
export const FETCH_CHUNK_BYTES = 4 * 1024 * 1024;

/** 单片默认的**空闲**超时（毫秒）。它只关「多久放弃这一片」，不改「走不走得完」。 */
export const FETCH_CHUNK_TIMEOUT_MS = 30000;

/** 单片默认重试几次（**只重试这一片**，已落盘的部分不重下）。 */
export const FETCH_CHUNK_RETRIES = 3;

/**
 * 片长退到多小就不再退了（字节）。
 *
 * 16 KiB 是「再小就不值得起一个进程」与「小到一条只稳定吐十几 KB 的链路也接得住」
 * 之间的折中：现场探测读到的实收字节数正在 15–16 KB 这一档。到这一档仍走不完
 * ⇒ 这条链路连小响应都不给，那确实不在这条路的射程里（交给 Playwright 的老路
 * 与 `playwrightReachability()` 那份取证）。
 */
export const FETCH_MIN_CHUNK_BYTES = 16 * 1024;

/**
 * 片数上限 —— 防「服务器给的 `content-length` 巨大 / 骗人」把这一步拖死，也防
 * 「片长降到下限后一片也走不完」时无限重试。114 MiB 按 16 KiB 一片约 7300 片，
 * 所以上限取 16k 时**留有退到下限仍能走完**的余量（1 GiB 的包也够）。
 */
export const FETCH_MAX_CHUNKS = 16384;

/**
 * 把 `url` **分片**拉到 `dest`，已存在且长度对得上就直接算完成（可重入）。
 *
 * ## 片长是**自适应**的：走不动就把片缩小，而不是放弃
 *
 * 现场那条链路能吐多少字节是**量不出来**的（探测只证明「前几 KB 流得过」）。所以这里
 * 不赌一个片长，而是**从大往小退**：一片连续 `retries` 次都走不完 ⇒ 把片长减半
 * （`FETCH_MIN_CHUNK_BYTES` 为下限）再试。一条「每次只稳定吐 15 KB」的链路因此不是
 * 「永远失败」，而是「多几轮、每轮小一点」—— 整包 114 MiB 走下 ~8000 片仍在
 * `FETCH_MAX_CHUNKS` 之内。
 *
 * 这是本层与 Playwright 那条路**唯一的、也是关键的**差别：它每失败一次就把整包扔了、
 * 从第 0 字节重来；这里失败只让**下一片小一点**，已落盘的字节一律不动。
 *
 * @param {string} url
 * @param {string} dest
 * @param {{
 *   chunkBytes?: number, minChunkBytes?: number, chunkTimeoutMs?: number,
 *   retries?: number, maxChunks?: number,
 *   onChunk?: (done: number, total: number) => void,
 *   fetchChunk?: (url: string, dest: string, offset: number, size: number, timeoutMs: number, options?: {probeOnly?: boolean}) => {bytes: number, total: number | null, out: string},
 * }} [options]
 *   `fetchChunk` 是注入面（默认 {@link fetchRangeToFile}）：判据里换掉它就不出网。
 *   `onChunk` 是进度读数（本步无进度条，交给调用方打一行）。
 * @returns {{ok: boolean, out: string, bytes: number, total: number | null, chunks: number, chunkBytes: number}}
 */
export function fetchUrlResumable(
  url,
  dest,
  {
    chunkBytes = FETCH_CHUNK_BYTES,
    minChunkBytes = FETCH_MIN_CHUNK_BYTES,
    chunkTimeoutMs = FETCH_CHUNK_TIMEOUT_MS,
    retries = FETCH_CHUNK_RETRIES,
    maxChunks = FETCH_MAX_CHUNKS,
    onChunk = undefined,
    fetchChunk = fetchRangeToFile,
  } = {},
) {
  mkdirSync(path.dirname(dest), { recursive: true });
  /* **先问总长**（一次 `Range: bytes=0-0`，不落盘）：它既是「这条链路通不通」的读数，
   * 也是「还剩多少」的分母。取不到就直接交给 Playwright 的老路。 */
  const head = fetchChunk(url, dest, 0, 1, chunkTimeoutMs, { probeOnly: true });
  const headTotal = head.total;
  if (headTotal === null || !Number.isFinite(headTotal) || headTotal <= 0) {
    return {
      ok: false,
      out:
        `取不到 ${url} 的总长度（${head.out || "无读数"}）—— ` +
        "这一档交给 playwright install 的老路。",
      bytes: 0,
      total: null,
      chunks: 0,
      chunkBytes,
    };
  }
  /** 到这里 `headTotal` 已经是一个正数（上面那一支把所有非正 / 空的形态都截住了）。 */
  const total = headTotal;
  const before = existsSync(dest) ? statSync(dest).size : 0;
  if (before > total) {
    /* 上一次留着的是坏文件（比声明长），删掉重来 —— 别拿它往前接。 */
    rmSync(dest, { force: true });
  }
  let written = existsSync(dest) ? statSync(dest).size : 0;
  if (written >= total) {
    return {
      ok: true,
      out: `已完整落盘（${written} 字节）`,
      bytes: written,
      total,
      chunks: 0,
      chunkBytes,
    };
  }
  let size = Math.max(minChunkBytes, Math.min(chunkBytes, total - written));
  let chunks = 0;
  while (written < total) {
    if (++chunks > maxChunks) {
      return {
        ok: false,
        out: `片数超过 ${maxChunks} 仍未取完（已取 ${written}/${total}，片长已退到 ${size}）—— 停下来交给老路`,
        bytes: written,
        total,
        chunks,
        chunkBytes: size,
      };
    }
    const want = Math.min(size, total - written);
    let got = -1;
    let lastOut = "";
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const r = fetchChunk(url, dest, written, want, chunkTimeoutMs);
      /* `got` 是**这一片真写进去的字节数**（<=0 = 这一片没成）。不假设服务器老实回了
       * 我问的那一段 —— `fetchRangeToFile` 只追加它读到的，所以「少给了」只会让下一片
       * 从更靠后的偏移接着接。 */
      if (r.bytes > 0) {
        got = r.bytes;
        break;
      }
      /* ⚠️ **失败的那一片要能整片丢掉**。所以子进程写的是**临时件**、只有它整片走完
       * 才由父进程追加到 `dest` 上（见 `fetchRangeToFile` 的 `scratch` 参数）。
       * 边读边往 `dest` 里写会让「写到一半超时」在文件里留下一截半成品，而下一次从
       * `written` 重试会和它**重叠** —— 实测那样写出来的 1 MiB 包会涨到 3.6 MiB。 */
      lastOut = r.out;
    }
    if (got <= 0) {
      /* 片长退一档再试 —— **已落盘的字节一个都不动**（这正是 Playwright 那条路做不到的）。 */
      if (size > minChunkBytes) {
        size = Math.max(minChunkBytes, Math.floor(size / 2));
        continue;
      }
      return {
        ok: false,
        out: `偏移 ${written} 处已退到最小片长 ${minChunkBytes} 仍取不到：${lastOut}`,
        bytes: written,
        total,
        chunks,
        chunkBytes: size,
      };
    }
    written += got;
    /* 一片顺利走完 ⇒ 片长**回长**（不超过初始档）：链路只是偶尔抖的时候别把自己
     * 永久钉在小片长上（那会把一次小抖动的代价留到剩下的每一步）。 */
    if (size < chunkBytes) size = Math.min(chunkBytes, size * 2);
    onChunk?.(written, total);
  }
  return {
    ok: true,
    out: `取完 ${written}/${total} 字节（${chunks} 片）`,
    bytes: written,
    total,
    chunks,
    chunkBytes: size,
  };
}

/**
 * 真取一段字节，**整片走完才**追加到 `dest`（走到一半就断的那一片由调用方丢掉）。
 *
 * ## 为什么不让子进程直接往 `dest` 上追加
 *
 * 子进程是边读边写的，而「超时 / 被断开」正好发生在写到一半的时候。那样一来到最后
 * 一片失败时，文件里留下的是一截**半成品**，调用方按 `written` 重试就会与它重叠 ——
 * 实测把 1 MiB 的包写成了 3.6 MiB（比声明的总长还长，收尾那一片永远等不到）。
 *
 * 所以：片先落到 `<dest>.part`（覆盖写），成功才把它接到 `dest` 尾巴上。失败走开时
 * `dest` 仍是「最后一个完整边界」的样子 —— 这正是「续传」成立的前提。
 *
 * ## 走的还是 `spawnSync` 起短命子进程
 *
 * 理由见文件头（同步退出码路径 + `node:http` 是回调式）。六件输入按 argv 传：
 * URL、脚手架文件、偏移、长度、超时、是否只要总长。
 *
 * `probeOnly` 那一档只问 `content-range` / `content-length`，**不落盘**
 * —— 「这条链路通不通 + 总长多少」那次读数量的是它。
 *
 * @param {string} url
 * @param {string} dest
 * @param {number} offset
 * @param {number} size
 * @param {number} timeoutMs
 * @param {{probeOnly?: boolean}} [options]
 * @returns {{bytes: number, total: number | null, out: string}}
 */
export function fetchRangeToFile(
  url,
  dest,
  offset,
  size,
  timeoutMs,
  { probeOnly = false } = {},
) {
  const scratch = `${dest}.part`;
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      FETCH_CHUNK_SCRIPT,
      url,
      scratch,
      String(offset),
      String(size),
      String(timeoutMs),
      probeOnly ? "1" : "0",
    ],
    { encoding: "utf8", windowsHide: true, timeout: timeoutMs + 5000 },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  /* 子进程把结论打成一行 `OK <bytes> <total>` / `ERR <原因>` —— 解析在这里、
   * 取证在网上那一次。解析不到（被砍 / 崩了）当成「这一片没成」。 */
  const line = out.split("\n").find((l) => /^(OK|ERR)\b/.test(l.trim()));
  if (!line) {
    rmSync(scratch, { force: true });
    return { bytes: -1, total: null, out: out || "（子进程没有输出）" };
  }
  const [tag, a, b] = line.trim().split(/\s+/);
  if (tag === "ERR") {
    rmSync(scratch, { force: true });
    return { bytes: -1, total: null, out };
  }
  const bytes = Number(a);
  const total = b === undefined || b === "null" ? null : Number(b);
  if (probeOnly) {
    rmSync(scratch, { force: true });
    return { bytes, total, out };
  }
  /* 整片走完才接上去 —— 这一支就是「续传」的边界。 */
  try {
    const part = readFileSync(scratch);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, part, { flag: "a" });
    rmSync(scratch, { force: true });
    return { bytes: part.length, total, out };
  } catch (e) {
    rmSync(scratch, { force: true });
    return {
      bytes: -1,
      total: null,
      out: `接片失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * {@link fetchRangeToFile} 在子进程里跑的载荷 —— 独立成常量，理由与
 * `DOWNLOAD_PROBE_SCRIPT` 逐字相同（它本来就自足，留在函数里只会把「做什么」压过
 * 「怎么做」）。
 *
 * argv：`[1]` URL、`[2]` 目标文件、`[3]` 偏移、`[4]` 长度、`[5]` 超时、`[6]` 只要总长。
 */
export const FETCH_CHUNK_SCRIPT = `
  const { request } = require("node:https");
  const { request: httpRequest } = require("node:http");
  const fs = require("node:fs");
  const url = process.argv[1];
  const dest = process.argv[2];
  const offset = Number(process.argv[3]);
  const size = Number(process.argv[4]);
  const timeoutMs = Number(process.argv[5]);
  const probeOnly = process.argv[6] === "1";
  const fail = (why) => { process.stdout.write("ERR " + why); process.exit(0); };
  // 总长：优先取 content-range 的 "/<total>"（分片响应给的就是它），
  // 退回 content-length（整包响应）。
  const totalOf = (res) => {
    const cr = res.headers["content-range"];
    if (typeof cr === "string") {
      const m = /\\/(\\d+)\\s*$/.exec(cr);
      if (m) return Number(m[1]);
    }
    const cl = Number(res.headers["content-length"]);
    if (Number.isFinite(cl) && cl > 0) return cl;
    return null;
  };
  let settled = false;
  const done = (line) => { if (settled) return; settled = true; process.stdout.write(line); process.exit(0); };
  let fd = null;
  if (!probeOnly) {
    try {
      fd = fs.openSync(dest, "a");
    } catch (e) { done("ERR 打不开目标文件：" + (e && e.message)); }
    if (settled) process.exit(0);
  }
  const send = url.startsWith("http:") ? httpRequest : request;
  const req = send(
    url,
    {
      method: "GET",
      headers: {
        Range: "bytes=" + offset + "-" + (offset + size - 1),
        "Accept-Encoding": "identity",
      },
      timeout: timeoutMs,
    },
    (res) => {
      const code = res.statusCode || 0;
      // 200（服务端不认 Range，回了整包）与 206 都算「能读」；其余交给上层判。
      if (probeOnly) {
        res.resume();
        res.on("end", () => {
          if (code >= 200 && code < 300) done("OK 0 " + (totalOf(res) ?? "null"));
          else done("ERR HTTP " + code);
        });
        res.on("error", (e) => done("ERR " + (e && e.message)));
        return;
      }
      if (code !== 200 && code !== 206) {
        res.resume();
        return done("ERR HTTP " + code);
      }
      let n = 0;
      let stop = false;
      res.on("data", (chunk) => {
        if (stop) return;
        // 只写这一次要的那一段：偏移对得上就整块写，偏移落在块里就切一刀。
        let start = offset + n;
        let take = chunk;
        if (offset > start) {
          const skip = offset - start;
          if (skip >= chunk.length) return;
          take = chunk.subarray(skip);
          start = offset;
        }
        const room = size - n;
        if (room <= 0) return;
        if (take.length > room) take = take.subarray(0, room);
        try {
          fs.writeSync(fd, take);
        } catch (e) {
          stop = true;
          return done("ERR 写盘失败：" + (e && e.message));
        }
        n += take.length;
        if (n >= size) {
          // 收到我要的那一段就收手（这一片不是「下载整包」）。
          stop = true;
          req.destroy();
          done("OK " + n + " " + (totalOf(res) ?? "null"));
        }
      });
      res.on("end", () => {
        if (stop) return;
        done(n > 0 ? "OK " + n + " " + (totalOf(res) ?? "null") : "ERR 这一片 0 字节");
      });
      res.on("error", (e) => { if (!stop) done("ERR " + (e && e.message)); });
    },
  );
  req.on("timeout", () => { req.destroy(); done("ERR 超时（" + timeoutMs + "ms 内这一片没走完）"); });
  req.on("error", (e) => done("ERR " + ((e && e.code) || "ERROR") + "：" + ((e && e.message) || "")));
  req.end();
`;

/**
 * 「把这一件浏览器**取到落点**」—— 取包 → 复验大小 → 解压 → 写完成标记。
 *
 * ## 它写的那一份标记是**上游的口径**，不是本仓发明的
 *
 * `INSTALLATION_COMPLETE` 是 Playwright 自己的标记（`browserDirectoryToMarkerFilePath()`）：
 * 它在、且二进制在，`playwright install` 就报 `already downloaded` 并跳过下载。
 * 所以这条路成功之后，后面那一步**逐字**就是 no-op，不存在「两份状态打架」。
 *
 * ## 落点目录名也要对得上
 *
 * `chromium_headless_shell-<revision>` 里的 `<revision>` **现读**
 * `playwright-core/browsers.json`（同 `ci-toolchain-browser-reach.mjs` 的
 * `readPlaywrightBrowserTarget()`，不在这里抄第二份）——
 * 写错一个数字的后果是「装了一份没人会用的东西」，而那看起来与成功逐字同形。
 *
 * @param {{
 *   url: string,
 *   root: string,
 *   dirName: string,
 *   marker: string,
 *   exeName: string,
 *   destZip?: string,
 *   fetch?: typeof fetchUrlResumable,
 *   extract?: (zip: string, dir: string) => string | null,
 *   exists?: (p: string) => boolean,
 * }} input
 *   `fetch` / `extract` / `exists` 都是注入面（判据里换掉它们就不出网、不落盘）。
 * @returns {{ok: boolean, out: string}}
 */
export function fetchPlaywrightBrowser({
  url,
  root,
  dirName,
  marker,
  exeName,
  destZip = undefined,
  fetch = fetchUrlResumable,
  extract = extractZipTo,
  exists = existsSync,
}) {
  const dir = path.join(root, dirName);
  if (exists(path.join(dir, marker)) && findUnder(dir, exeName)) {
    return { ok: true, out: `已就位：${dir}` };
  }
  const zip = destZip ?? path.join(root, `${dirName}.zip`);
  const got = fetch(url, zip);
  if (!got.ok) return { ok: false, out: got.out };
  mkdirSync(dir, { recursive: true });
  const failure = extract(zip, dir);
  if (failure) return { ok: false, out: `解压失败：${failure}` };
  const exe = findUnder(dir, exeName);
  if (!exe) {
    return { ok: false, out: `解出来没有 ${exeName}（落点：${dir}）` };
  }
  writeFileSync(path.join(dir, marker), "");
  /* 包已解出来就不必留着 —— 它 100+ MiB，而落点目录是长期存在的那一份。 */
  rmSync(zip, { force: true });
  return { ok: true, out: exe };
}

/**
 * 解一个 zip 到目标目录，成功回 `null`、失败回一句原因。
 *
 * ## 为什么**不**走 `tar -xf`（`ci-toolchain-python.mjs` 的 `unzipArchive()` 那条路）
 *
 * 那条路押的是「Windows 10 起自带的 `tar` 是 bsdtar、bsdtar 认 zip」。两件事都是真的，
 * 但**只在那一个平台上**：GNU tar（Linux / macOS 上的 `/usr/bin/tar`）根本不读 zip ——
 * 实测对同一个包逐字报「这不是 tar 归档」然后退非零（错误原文两行，原样引用）：
 *
 *     （原文）tar: This does not look like a tar archive
 *     （原文）tar: Exiting with failure status due to previous errors
 *
 * 而这一步是**全平台**的（`浏览器安装` 在自托管 Windows 节点上跑，本地开发机大概率在
 * Linux / macOS 上）。押一个平台的压缩器形态，等于给「换台机器跑」埋一枪。
 *
 * ## 所以自己读 zip —— 只读这两档需要的形状
 *
 * `node:zlib` 的 `inflateRawSync()` 加上一份**只认 central directory** 的解析：
 * 两个压缩档（`0` = 原样、`8` = deflate）、按 `external_attr` 复原 Unix 权限位
 * （`chrome-headless-shell` 必须是可执行的）、按 `\n` 归一化路径段。
 *
 * 上游那个包实测（`chrome-headless-shell-linux64.zip`）：287 个条目、`{0, 8}` 两档、
 * **无 zip64**，所以这里刻意**不**实现 zip64 —— 真遇到时按「不认」失败（比悄悄解错强），
 * 而那时 Playwright 的老路仍在那儿。
 *
 * @param {string} zip
 * @param {string} dir
 * @returns {string | null}
 */
export function extractZipTo(zip, dir) {
  let buf;
  try {
    buf = readFileSync(zip);
  } catch (e) {
    return `zip 读不出来：${e instanceof Error ? e.message : String(e)}`;
  }
  const entries = readCentralDirectory(buf);
  if (typeof entries === "string") return entries;
  for (const e of entries) {
    const target = path.join(dir, ...e.name.split("/").filter((p) => p !== ""));
    /* **防目录穿越**：包里的名字不回退、不绝对 —— 它来自网上的文件，不该由它决定
     * 往哪儿写（上游的包当然规规矩矩，但这一步的输入不该被信任）。 */
    if (!target.startsWith(path.resolve(dir))) {
      return `条目的路径越出了目标目录：${e.name}`;
    }
    if (e.name.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    let data;
    try {
      data = e.stored
        ? buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize)
        : inflateRawSync(
            buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize),
          );
    } catch (err) {
      return `解压 ${e.name} 失败：${err instanceof Error ? err.message : String(err)}`;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    /* 权限位跟着包走：headless shell 那个可执行文件没有它，后面 `chromium.launch()`
     * 会在 POSIX 上以 EACCES 收场，而报错指不到这一步。 */
    if (e.mode) {
      try {
        chmodSync(target, e.mode);
      } catch {
        /* 平台不支持就跳过（Windows 上 chmod 基本是 no-op）—— 那不是失败。 */
      }
    }
  }
  return null;
}

/**
 * 读 zip 的 **central directory**，回条目数组（错回一句原因）。
 *
 * 只读 central directory（不扫 local header）：条目名、压缩档、长度、权限位、
 * 以及 local header 的偏移都在里面 —— 那是唯一一处能一次拿全的地方。
 *
 * @param {Buffer} buf
 * @returns {Array<{name: string, stored: boolean, compressedSize: number, dataOffset: number, mode: number}> | string}
 */
function readCentralDirectory(buf) {
  /* EOCD 在文件尾、后面最多 64 KiB 的注释（规格允许）。 */
  let eocd = -1;
  for (
    let i = buf.length - 22;
    i >= Math.max(0, buf.length - 22 - 65535);
    i -= 1
  ) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "不是 zip（找不到 EOCD）";
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      return `central directory 第 ${n} 条读不动`;
    }
    const madeBy = buf.readUInt16LE(p + 4);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    if (method !== 0 && method !== 8) {
      return `不认的压缩档 ${method}（只认 0 = 原样 / 8 = deflate）`;
    }
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    /* local header 的长度能变（`extra` 与 central directory 那份不一样），
     * 所以数据偏移必须**现读 local header**而不是照抄 central 的 extra 长度。 */
    if (
      localOffset + 30 > buf.length ||
      buf.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      return `${name} 的 local header 读不动`;
    }
    const lName = buf.readUInt16LE(localOffset + 26);
    const lExtra = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + lName + lExtra;
    /* 权限位只在**外部属性**里（高 16 位），且只在 Unix（`madeBy` 高字节 = 3）时有意义。 */
    const mode = madeBy >> 8 === 3 ? (externalAttr >>> 16) & 0o7777 : 0;
    out.push({ name, stored: method === 0, compressedSize, dataOffset, mode });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * 读不到上游 `browsers.json` 时那一版落点目录用的 `revision`（**缺省，不是判据**）。
 *
 * 与 `PLAYWRIGHT_FALLBACK_BROWSER_VERSION`（CDN 路径里那个 `browserVersion`）是
 * **两个不同的号**，别互相顶替。它只在「依赖还没装 / `browsers.json` 读不到」时
 * 顶上；真读到了就以盘上那份为准。
 */
export const PLAYWRIGHT_FALLBACK_BROWSER_REVISION = "1243";

/** 本档要装的那一件（与 `ci-toolchain-browser.mjs` 的 `BROWSER_PACKAGES` 同源）。 */
export const BROWSER_PACKAGE_NAME = "chromium-headless-shell";

/** 上游那份落点完成标记（`browserDirectoryToMarkerFilePath()` 的口径，不是本仓发明的）。 */
export const INSTALLATION_COMPLETE_MARKER = "INSTALLATION_COMPLETE";

/**
 * 落点里那一版的目录名（`chromium_headless_shell-<revision>`）。
 *
 * ⚠️ **目录名里用的是 `revision`，不是 `browserVersion`**：前者是 `1243`、后者是
 * `153.0.8010.12`（CDN 路径里用的才是后者）。拿错一个号的后果不是「报错」，
 * 而是**两个方向都像成功**：包解到一个没人会看的目录，Playwright 随即
 * `Removing unused browser` 把整包重下一遍 —— 自取白做、日志里却各说各的成功。
 * 两个号都由 `readPlaywrightBrowserTarget()` 一处读出来（**不抄第二遍**）。
 *
 * 形状逐字照抄上游 `browserDirectoryToMarkerFilePath()` 那一半：
 * `name.replace(/-/g, "_") + "-" + revision`（`chromium-headless-shell` →
 * `chromium_headless_shell`）。
 *
 * @param {{revision: string} | null} target 读不到 `browsers.json` 时给 `null`
 * @param {string} [fallbackRevision] 缺省那一档（探测那条路同一个）
 * @returns {string} 两个号都读不到时回 `""`（**不给一个猜的目录名**）
 */
export function browserDirName(target, fallbackRevision = undefined) {
  const revision = target?.revision ?? fallbackRevision;
  if (!revision) {
    /* 写错一个数字的后果是「装了一份没人会用的东西」，而那看起来与成功逐字同形
     * —— 宁可让调用方看到「自取没成」。 */
    return "";
  }
  return `${BROWSER_PACKAGE_NAME.replace(/-/g, "_")}-${revision}`;
}

/**
 * 「这一件」的可执行文件名（按**目标平台**，与 `browserExecutableExists()` 同口径）。
 *
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function playwrightExeName(platform = undefined) {
  return (platform ?? process.platform) === "win32"
    ? "chrome-headless-shell.exe"
    : "chrome-headless-shell";
}

/**
 * 在 `dir` 下按深度上限找一个文件名（**不穿符号链接**，越界即停）。
 *
 * 与 `ci-toolchain-browser-root.mjs` 的 `findBrowserExecutable()` 是**同一条判据的两个调用点**：
 * 那个判「装完的落点里有那一件」，这个判「刚解出来的落点里有那一件」。刻意不抽共享
 * 模块：两处的 `dir` 语义（一个是落点根、一个是那一版的目录）与深度不同，
 * 而这一支只服务本文件的复验 —— 真正要一致的是**判什么**（那个文件名），
 * 它由调用方按 `BROWSER_PACKAGES` 给。
 *
 * @param {string} dir
 * @param {string} name
 * @param {number} depth
 * @returns {string | null}
 */
function findUnder(dir, name, depth = 3) {
  if (depth < 0) return null;
  const entries = listDir(dir);
  if (!entries) return null;
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) {
      const hit = findUnder(full, name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * `readdirSync(dir, { withFileTypes: true })` 的**失败即 null** 形态。
 *
 * @param {string} dir
 * @returns {import("node:fs").Dirent[] | null}
 */
function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}
