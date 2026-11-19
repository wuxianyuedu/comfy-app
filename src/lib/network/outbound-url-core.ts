import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { upperTokenOr } from "~/lib/upper-token";

/**
 * 服务端出网 URL 的统一约束入口（单一实现，#3904/#4052）。
 *
 * 背景：多处把调用方可控输入直接喂给 `fetch`（LLM 探测/用量测试的 Base URL、
 * 工坊远程媒体引用），既不统一限 scheme，也不拦内网/回环/链路本地/云元数据与
 * 重定向目标 —— 形成 SSRF / 内网与本机服务探测面。本模块把「这个地址允不允许
 * 出网、按什么场景约束」收到一处，后续新增「按 URL 拉取/探测」能力必须复用它，
 * 不再各写一遍。
 *
 * 场景按「调用方为什么要连」分，而不是按调用点分：
 * - `llm-upstream`：用户配置/填写的模型服务端点（本地 Ollama/LM Studio、局域网
 *   网关、或远程 SaaS）。允许回环与私网（合法本地/配置化服务），但仍拦截链路
 *   本地与云元数据等高风险目标。
 * - `remote-media`：用户提供的远程媒体引用（工坊参考图等）。只允许可路由的公
 *   网目标，拦截回环/私网/链路本地/云元数据，收紧对内网的探测面。
 *
 * 重定向：`fetch` 默认跟随，目标地址若不再过同一套约束即等于绕过。本模块提供
 * `safeFetch` 以 `redirect: "manual"` 逐跳校验；`assertSafeOutboundUrl` 只校验
 * 单个 URL（供「先拼地址再自己发请求」的调用点在每一跳前复用）。
 *
 * @module lib/outbound-url-core
 *
 * **为什么这份实现不带 `import "server-only"`**（#4452）：出网判据要同时服务
 * Next 服务端（经 `./outbound-url.server` 的薄再导出）与**纯 Node 宿主**
 * （MCP/stdio 通道的 `api-channel.ts`，由 executor-host 加载）——server-only
 * 入口在纯 Node 宿主里直接 throw，会把宿主侧的 SSRF 约束逼成裸 fetch。本模块
 * 只依赖 node:dns / node:net / 全局 fetch，两类宿主都能加载；`.server.ts` 只剩
 * `import "server-only"` + 再导出，Next 侧既有 import 面不变。
 */

/** 出网场景：决定「哪些目标算合法」。 */
export type OutboundUrlScenario = "llm-upstream" | "remote-media";

/** 约束失败（可观测错误）。message 面向调用方展示，不含内部实现细节。 */
export class UnsafeOutboundUrlError extends Error {
  override readonly name = "UnsafeOutboundUrlError";
}

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.internal.",
  "metadata",
  "metadata.",
  "instance-data",
  "instance-data.",
]);

function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function unbracket(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isIpv4InCidr(ip: string, baseA: number, baseB: number, maskBits: number): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const a = nums[0] ?? 0;
  const b = nums[1] ?? 0;
  const c = nums[2] ?? 0;
  const d = nums[3] ?? 0;
  const value = (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
  const base = (((baseA << 24) >>> 0) + (baseB << 16)) >>> 0;
  const mask = maskBits === 0 ? 0 : (0xff_ff_ff_ff << (32 - maskBits)) >>> 0;
  return (value & mask) === (base & mask);
}

function isLoopbackIpv4(ip: string): boolean {
  return isIpv4InCidr(ip, 127, 0, 8);
}

function isPrivateIpv4(ip: string): boolean {
  return (
    isIpv4InCidr(ip, 10, 0, 8) || isIpv4InCidr(ip, 172, 16, 12) || isIpv4InCidr(ip, 192, 168, 16)
  );
}

/** 链路本地：169.254.0.0/16（含云实例元数据 169.254.169.254）。 */
function isLinkLocalIpv4(ip: string): boolean {
  return isIpv4InCidr(ip, 169, 254, 16);
}

/** 100.64.0.0/10 运营商级 NAT（RFC 6598）——对外不可达的共享地址空间。 */
function isCarrierGradeNatIpv4(ip: string): boolean {
  return isIpv4InCidr(ip, 100, 64, 10);
}

function isUnspecifiedIpv4(ip: string): boolean {
  return ip === "0.0.0.0";
}

function isMulticastOrReservedIpv4(ip: string): boolean {
  const first = Number(ip.split(".")[0]);
  if (!Number.isInteger(first)) {
    return true;
  }
  // 224.0.0.0/4 组播，240.0.0.0/4 保留（含 255.255.255.255 广播）
  return first >= 224;
}

function isBenchmarkIpv4(ip: string): boolean {
  // 198.18.0.0/15 基准测试网段
  return isIpv4InCidr(ip, 198, 18, 15);
}

function expandIpv6(raw: string): string | null {
  const zoneStripped = raw.split("%", 1)[0] ?? "";
  const lower = zoneStripped.toLowerCase();
  const mapped = /^::ffff:(?<v4>\d+\.\d+\.\d+\.\d+)$/u.exec(lower);
  if (mapped?.groups?.v4 !== undefined) {
    return `::ffff:${mapped.groups.v4}`;
  }
  const parts = lower.split("::");
  if (parts.length > 2) {
    return null;
  }
  const headRaw = parts[0];
  const tailRaw = parts[1];
  const head = headRaw !== undefined && headRaw !== "" ? headRaw.split(":") : [];
  const tail = tailRaw !== undefined && tailRaw !== "" ? tailRaw.split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) {
    return null;
  }
  const full =
    parts.length === 2 ? [...head, ...Array.from({ length: fill }, () => "0"), ...tail] : head;
  if (full.length !== 8) {
    return null;
  }
  const padded = full.map((seg) => seg.padStart(4, "0"));
  if (padded.some((seg) => !/^[0-9a-f]{4}$/u.test(seg))) {
    return null;
  }
  return padded.join(":");
}

function ipv4FromMappedIpv6(expanded: string): string | null {
  const m = /^0000:0000:0000:0000:0000:ffff:(?<v4>\d+\.\d+\.\d+\.\d+)$/u.exec(expanded);
  if (m?.groups?.v4 !== undefined) {
    return m.groups.v4;
  }
  // ::ffff:wxyz 形式在 expand 前已部分处理；再处理 hex 形式 ::ffff:7f00:1
  const hex = /^0000:0000:0000:0000:0000:ffff:(?<hi>[0-9a-f]{4}):(?<lo>[0-9a-f]{4})$/u.exec(
    expanded,
  );
  const hiHex = hex?.groups?.hi;
  const loHex = hex?.groups?.lo;
  if (hiHex === undefined || loHex === undefined) {
    return null;
  }
  const hi = Number.parseInt(hiHex, 16);
  const lo = Number.parseInt(loHex, 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function classifyIpv6(
  expanded: string,
): "blocked" | "link-local" | "loopback" | "private" | "public" {
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") {
    return "loopback";
  }
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") {
    return "blocked"; // unspecified
  }
  const first = Number.parseInt(expanded.slice(0, 4), 16);
  // fc00::/7 unique local
  if ((first & 0xfe_00) === 0xfc_00) {
    return "private";
  }
  // fe80::/10 link-local
  if ((first & 0xff_c0) === 0xfe_80) {
    return "link-local";
  }
  // ff00::/8 multicast
  if ((first & 0xff_00) === 0xff_00) {
    return "blocked";
  }
  return "public";
}

type IpClass = "blocked" | "link-local" | "loopback" | "private" | "public";

function classifyIpLiteral(ip: string): IpClass {
  const kind = isIP(ip);
  if (kind === 4) {
    if (isUnspecifiedIpv4(ip)) {
      return "blocked";
    }
    if (isLoopbackIpv4(ip)) {
      return "loopback";
    }
    if (isLinkLocalIpv4(ip)) {
      return "link-local";
    }
    if (isPrivateIpv4(ip) || isCarrierGradeNatIpv4(ip) || isBenchmarkIpv4(ip)) {
      return "private";
    }
    if (isMulticastOrReservedIpv4(ip)) {
      return "blocked";
    }
    return "public";
  }
  if (kind === 6) {
    const expanded = expandIpv6(ip);
    if (expanded === null) {
      return "blocked";
    }
    const mappedV4 = ipv4FromMappedIpv6(expanded);
    if (mappedV4 !== null) {
      return classifyIpLiteral(mappedV4);
    }
    return classifyIpv6(expanded);
  }
  return "blocked";
}

function rejectForClass(
  cls: IpClass,
  scenario: OutboundUrlScenario,
  targetLabel: string,
): string | null {
  if (cls === "public") {
    return null;
  }
  if (cls === "link-local") {
    return `不允许访问链路本地/元数据地址（${targetLabel}）`;
  }
  if (cls === "blocked") {
    return `不允许访问该目标地址（${targetLabel}）`;
  }
  if (scenario === "remote-media") {
    if (cls === "loopback") {
      return `不允许从回环地址拉取远程媒体（${targetLabel}）`;
    }
    // 此时 cls 只剩 private（public/link-local/blocked/loopback 已处理）
    return `不允许从内网/私有地址拉取远程媒体（${targetLabel}）`;
  }
  // llm-upstream: loopback/private 合法（本地与局域网服务），其余已拦
  return null;
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeOutboundUrlError("URL 格式无效");
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    throw new UnsafeOutboundUrlError(`仅允许 http/https 协议（当前为 ${url.protocol || "未知"}）`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new UnsafeOutboundUrlError("URL 不允许包含内嵌凭据");
  }
  if (url.hostname === "") {
    throw new UnsafeOutboundUrlError("URL 缺少主机名");
  }
  return url;
}

async function resolveAndCheck(rawHostname: string, scenario: OutboundUrlScenario): Promise<void> {
  const hostname = unbracket(rawHostname);

  // 先查字面 IP（含 URL 主机名的 [::1] 形式）
  if (isIP(hostname) !== 0) {
    const cls = classifyIpLiteral(hostname);
    const reason = rejectForClass(cls, scenario, hostname);
    if (reason !== null) {
      throw new UnsafeOutboundUrlError(reason);
    }
    return;
  }

  const normalized = normalizeHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    const reason = rejectForClass("loopback", scenario, normalized);
    if (reason !== null) {
      throw new UnsafeOutboundUrlError(reason);
    }
    return;
  }
  if (METADATA_HOSTS.has(normalized) || normalized.endsWith(".internal")) {
    throw new UnsafeOutboundUrlError(`不允许访问元数据/内部域名（${normalized}）`);
  }

  // 解析主机名并逐个校验解析结果，降低通过域名指向内网地址的绕过面
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, order: "verbatim" });
  } catch {
    // DNS 解析失败：不在这里判为 SSRF，交给后续 fetch 报连接错误（更可读）
    return;
  }
  if (records.length === 0) {
    return;
  }
  for (const record of records) {
    const cls = classifyIpLiteral(record.address);
    const reason = rejectForClass(cls, scenario, `${hostname} -> ${record.address}`);
    if (reason !== null) {
      throw new UnsafeOutboundUrlError(reason);
    }
  }
}

/**
 * 校验单个出网 URL 是否符合场景约束。合法则返回规范化后的 URL 字符串，
 * 非法抛出 `UnsafeOutboundUrlError`（可观测、可直接展示的原因）。
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  scenario: OutboundUrlScenario,
): Promise<string> {
  const url = parseHttpUrl(rawUrl);
  await resolveAndCheck(url.hostname, scenario);
  return url.toString();
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function redirectLocation(res: Response, current: URL): string | null {
  const location = res.headers.get("location");
  if (location === null || location.trim() === "") {
    return null;
  }
  try {
    return new URL(location, current).toString();
  } catch {
    return null;
  }
}

export type SafeFetchInit = RequestInit & {
  /** 最大重定向次数（默认 5）；设为 0 表示不跟随。 */
  maxRedirects?: number;
  /** 约束场景（必填）—— 不指定场景就不能出网。 */
  scenario: OutboundUrlScenario;
  /** 兜底超时（毫秒）：调用方**没传 `signal`** 时注入 `AbortSignal.timeout`。
   *  默认 60s（现有调用方的远程媒体/轮询预算在 30s 档）。传了 `signal` 的
   *  调用方维持原样——自己的预算自己定（ISSUE #4205：新调用方漏传时，
   *  这条 fetch 连同逐跳重定向会无限挂起）。 */
  timeoutMs?: number;
};

/** 调用方未传 `signal` 时的兜底超时。 */
const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 带统一 SSRF 约束的 `fetch`：校验初始 URL，并以 `redirect: "manual"` 逐跳
 * 校验重定向目标后再跟随。最终响应（非重定向）原样返回给调用方。
 *
 * 适用于需要跟随重定向且要拦截「跳转到内网/元数据」的场景（如远程媒体拉取）。
 * 对于需要流式读取响应体的调用方同样可用：返回的是最终 Response。
 */
export async function safeFetch(input: string | URL, init: SafeFetchInit): Promise<Response> {
  const {
    scenario,
    maxRedirects = MAX_REDIRECTS,
    timeoutMs = SAFE_FETCH_DEFAULT_TIMEOUT_MS,
    ...requestInit
  } = init;
  /* 兜底超时只注入一次、随整条重定向链共用同一份预算；调用方显式给了
   * `signal`（含 `null`）就以它为准。 */
  const signal = requestInit.signal ?? AbortSignal.timeout(timeoutMs);
  let currentUrl = await assertSafeOutboundUrl(String(input), scenario);
  let remaining = maxRedirects;

  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 重定向必须逐跳校验后再决定是否跟随
    const res = await fetch(currentUrl, { ...requestInit, signal, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) {
      return res;
    }

    const location = redirectLocation(res, new URL(currentUrl));
    // 丢弃重定向响应体，释放连接（不阻塞后续跳转）
    if (res.body !== null) {
      void res.body.cancel().catch(() => undefined);
    }

    if (location === null) {
      return res;
    }
    if (remaining <= 0) {
      throw new UnsafeOutboundUrlError("重定向次数超过限制");
    }
    remaining -= 1;

    // 303 / 301(POST->GET 语义由 fetch 实现差异处理，这里按安全保守：POST/非GET在跨跳时改GET)
    const method = upperTokenOr(requestInit.method, "GET");
    if (
      (res.status === 303 || res.status === 301 || res.status === 302) &&
      method !== "GET" &&
      method !== "HEAD"
    ) {
      requestInit.method = "GET";
      requestInit.body = undefined;
      if (requestInit.headers !== undefined) {
        const h = new Headers(requestInit.headers);
        h.delete("content-length");
        h.delete("content-type");
        requestInit.headers = h;
      }
    }

    // oxlint-disable-next-line eslint/no-await-in-loop -- 重定向目标必须逐跳校验，不能并行
    currentUrl = await assertSafeOutboundUrl(location, scenario);
  }
}

/** 是否为「出网地址被约束拦截」的错误（供调用点区分 SSRF 拦截与普通网络失败）。 */
export function isUnsafeOutboundUrlError(error: unknown): error is UnsafeOutboundUrlError {
  return error instanceof UnsafeOutboundUrlError;
}
