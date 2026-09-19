// POSIX 监听端口探测的回归测试（ISSUE #489 缺陷 3）。
//
// 背景：`findPidListeningPort` 的 POSIX 分支曾用 `lsof -Pan -p <pid> -iTCP
// -sTCP:LISTEN`。lsof 在很多发行版（含 CI 精简镜像）默认不装，且 execFile
// 的错误被静默吞成空串 → 函数返回 null —— 正是规范 §9.2 第 3 条禁止的
// 「静默失败」。文档 §9.1 还声称「不依赖 lsof」，与代码互相打架。
//
// 现在改为纯 Node 内建：`/proc/net/tcp{,6}` 的 LISTEN（state=0A）inode
// 与 `/proc/<pid>/fd/*` 里 `socket:[<inode>]` 的交集。这组用例锁住：
//   - 解析器对真实 /proc 格式的行为（含 tcp6 与非法行）；
//   - 端到端：真起一个监听 socket，能被该 pid 的 fd 交集命中；
//   - 失败路径：不存在 pid / 未监听 → null（而不是抛错）。
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  findListeningPortViaProc,
  parseNetstatListeningPort,
  parseProcNetTcpListeners,
  socketInodesOfPid,
} from "./proc-detect";

describe("parseProcNetTcpListeners", () => {
  it("只收 state=0A（LISTEN），端口按十六进制解析", () => {
    const content = [
      "  sl  local_address rem_address   st ... inode",
      // 0100007F:8707 = 127.0.0.1:34567, st=0A (LISTEN)
      "   0: 0100007F:8707 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 447711453 1 0000000000000000 100 0 0 10 0",
      // st=01 (ESTABLISHED) 必须被忽略
      "   1: 0100007F:1F90 0100007F:C350 01 00000000:00000000 00:00000000 00000000     0        0 111111111 1 0000000000000000 100 0 0 10 0",
    ].join("\n");
    const map = parseProcNetTcpListeners(content);
    expect(map.get("447711453")).toBe(34567);
    expect(map.has("111111111")).toBe(false);
  });

  it("容忍表头缺失 / 空行 / 字段不足的脏输入", () => {
    expect(parseProcNetTcpListeners("")).toEqual(new Map());
    expect(parseProcNetTcpListeners("garbage line\n\n   \n")).toEqual(
      new Map(),
    );
  });

  it("IPv6 行（local_address 更长）同样能取到端口", () => {
    // tcp6 的 local_address 是 32 位十六进制，形如 ::1 → 0000...01000000
    // 字段数与真实 /proc/net/tcp6 一致（0:local rem st tx:rx tr:when retrnsmt
    // uid timeout inode ...），确保只靠字段下标取值的解析器不被行形状差异骗过。
    // 首行按 /proc 惯例是表头，解析器会跳过 —— 这里保留表头以贴合真实输入。
    const content = [
      "  sl  local_address                         rem_address   st ...",
      "   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 222222222 1 0000000000000000 100 0 0 10 0",
    ].join("\n");
    expect(parseProcNetTcpListeners(content).get("222222222")).toBe(8080);
  });
});

describe.runIf(process.platform === "linux")("findListeningPortViaProc", () => {
  it("真起监听 socket：能按 pid 的 fd 交集拿到端口", async () => {
    const srv = net.createServer((s) => s.end());
    // 端口取一个高位随机值，避免与本机其他服务冲突
    const want = 30000 + Math.floor(Math.random() * 20000);
    await new Promise<void>((r) => srv.listen(want, "127.0.0.1", () => r()));
    try {
      expect(findListeningPortViaProc(process.pid)).toBe(want);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("进程未监听 / 不存在时返回 null（不抛错，由调用方给出口）", () => {
    expect(findListeningPortViaProc(999999)).toBeNull();
  });

  it("socketInodesOfPid 对不存在的 pid 返回空集", () => {
    expect(socketInodesOfPid(999999).size).toBe(0);
  });
});

/* ── Windows 侧的「更便宜的查询方式」（ISSUE #346 / #339 的查询成本） ──
 *
 * 两处判据都**只能靠断言命令形状与解析结果**来锁：真实 Windows 进程表 /
 * netstat 在这个测试环境里不存在，而它们要拦的回归恰恰是「换回贵的写法」——
 * 那种回归在 Linux 上跑什么都绿，只有把「命令里有什么」钉成断言才拦得住。 */
describe("Windows 命令行探测的口径", () => {
  it("parseNetstatListeningPort 认两种地址形态，按最后一列 PID 过滤", () => {
    const content = [
      "  TCP    127.0.0.1:8188         0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:8189         0.0.0.0:0              LISTENING       9999",
      "  TCP    127.0.0.1:50000        127.0.0.1:60000        ESTABLISHED     4242",
    ].join("\r\n");
    expect(parseNetstatListeningPort(content, 4242)).toBe(8188);
    // 他人 PID 的行不得被算成它的端口
    expect(parseNetstatListeningPort(content, 1234)).toBeNull();
    // 非 LISTENING（ESTABLISHED 的 50000）不算监听端口
    expect(
      parseNetstatListeningPort(content.split("\r\n")[2]!, 4242),
    ).toBeNull();
  });

  it("IPv6 行的端口按「最后一个冒号」切（不是第一个）", () => {
    const content =
      "  TCP    [::1]:8190              [::]:0                 LISTENING       7777";
    expect(parseNetstatListeningPort(content, 7777)).toBe(8190);
  });

  it("容忍表头 / 空行 / 字段不足的脏输入", () => {
    expect(parseNetstatListeningPort("", 1)).toBeNull();
    expect(parseNetstatListeningPort("garbage\n\n  \n", 1)).toBeNull();
    expect(parseNetstatListeningPort("TCP 127.0.0.1:1", 1)).toBeNull();
  });
});
