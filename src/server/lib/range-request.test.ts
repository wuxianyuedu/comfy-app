/**
 * `Range` 解析的判据（RFC 7233 单档）。
 *
 * 这一层值得单独测而不是只靠端点用例：它的**三种结论长得都很像**，而选错的代价
 * 不对称 —— 把「不认识的形状」判成 416，浏览器那条本来要整份的请求会变成播放失败
 * （比不支持 Range 更糟）；把「满足不了」判成忽略回整份，客户端拿不到它期待的 206。
 * 所以每种形状都要有断言，而且断的是 `kind`，不是某个偶然的数字。
 *
 * 边界按「size 给多少」来组织：`size` 是调用方从 `fs.stat` 拿到的真值，
 * 这里不碰磁盘，所以这些用例全是纯函数的形状判定。
 */
import { describe, expect, it } from "vitest";

import { contentRangeHeader, resolveByteRange } from "./range-request";

const SIZE = 1000;

describe("没有 Range 或不该解析的形状 → full（客户端要的其实是整份）", () => {
  it("头不存在与空串都算没要范围", () => {
    expect(resolveByteRange(null, SIZE)).toEqual({ kind: "full" });
    expect(resolveByteRange("", SIZE)).toEqual({ kind: "full" });
    expect(resolveByteRange("   ", SIZE)).toEqual({ kind: "full" });
  });

  it("不是 bytes= 的一律忽略（本应用没有别的单位）", () => {
    expect(resolveByteRange("seconds=10-20", SIZE)).toEqual({ kind: "full" });
    expect(resolveByteRange("bytes abc", SIZE)).toEqual({ kind: "full" });
  });

  it("`bytes=` 后面什么都没有、或两头都缺省（`bytes=-`），等于没要范围", () => {
    expect(resolveByteRange("bytes=", SIZE)).toEqual({ kind: "full" });
    expect(resolveByteRange("bytes=-", SIZE)).toEqual({ kind: "full" });
  });

  it("多档不解析：那要 multipart/byteranges，回整份比假装支持更安全", () => {
    expect(resolveByteRange("bytes=0-1,2-3", SIZE)).toEqual({ kind: "full" });
  });

  it("语法不认识的（无横线 / 非十进制 / 带符号 / 带空格）都忽略", () => {
    for (const header of [
      "bytes=abc",
      "bytes=10",
      "bytes=+1-9",
      "bytes=1-2-3",
      "bytes=1 - 9",
      "bytes=1.5-9",
    ]) {
      expect(resolveByteRange(header, SIZE), header).toEqual({ kind: "full" });
    }
  });

  it("first > last 按 RFC 是无效范围：忽略并回整份，不是 416", () => {
    expect(resolveByteRange("bytes=500-100", SIZE)).toEqual({ kind: "full" });
    // 顺序也要判：这条在一个 10 字节的文件上仍然算「语法无效」，不能因为
    // 起点已经越过文件末尾就被后面那条 size 判定抢走、变成 416。
    expect(resolveByteRange("bytes=500-100", 10)).toEqual({ kind: "full" });
  });
});

describe("合法的一档 → partial，且窗口是闭区间、按 size 裁过", () => {
  it("完整区间原样给（`0-0` 就是 1 个字节，不是 0 个）", () => {
    expect(resolveByteRange("bytes=0-0", SIZE)).toEqual({
      kind: "partial",
      window: { start: 0, endInclusive: 0 },
    });
    expect(resolveByteRange("bytes=100-199", SIZE)).toEqual({
      kind: "partial",
      window: { start: 100, endInclusive: 199 },
    });
  });

  it("开放终点 `bytes=a-` 到文件末尾", () => {
    expect(resolveByteRange("bytes=900-", SIZE)).toEqual({
      kind: "partial",
      window: { start: 900, endInclusive: 999 },
    });
  });

  it("终点超过文件长度时裁剪（RFC 要求服务端收边界，不许回一段不存在的字节）", () => {
    expect(resolveByteRange("bytes=990-99999", SIZE)).toEqual({
      kind: "partial",
      window: { start: 990, endInclusive: 999 },
    });
  });

  it("后缀形式 `bytes=-n` 取末尾 n 个字节（与「起点 0 终点 n」不是同一件事）", () => {
    expect(resolveByteRange("bytes=-20", SIZE)).toEqual({
      kind: "partial",
      window: { start: 980, endInclusive: 999 },
    });
    // 要得比整个文件还多：从 0 开始，不是负数起点
    expect(resolveByteRange("bytes=-5000", SIZE)).toEqual({
      kind: "partial",
      window: { start: 0, endInclusive: 999 },
    });
  });

  it("前后空白与大小写都不影响判定（浏览器一般规矩，但代理层不一定）", () => {
    expect(resolveByteRange("  BYTES=10-20  ", SIZE)).toEqual({
      kind: "partial",
      window: { start: 10, endInclusive: 20 },
    });
  });
});

describe("语法对而当前文件满足不了 → unsatisfiable（这一支才配 416）", () => {
  it("起点已在文件末尾之后", () => {
    expect(resolveByteRange("bytes=1000-", SIZE)).toEqual({
      kind: "unsatisfiable",
    });
    expect(resolveByteRange("bytes=1000-2000", SIZE)).toEqual({
      kind: "unsatisfiable",
    });
  });

  it("0 字节的文件给不出任何一档（含后缀形式）", () => {
    expect(resolveByteRange("bytes=0-0", 0)).toEqual({
      kind: "unsatisfiable",
    });
    expect(resolveByteRange("bytes=-5", 0)).toEqual({
      kind: "unsatisfiable",
    });
  });

  it("`bytes=-0` 要 0 个字节：满足不了，而不是回一个空窗口", () => {
    expect(resolveByteRange("bytes=-0", SIZE)).toEqual({
      kind: "unsatisfiable",
    });
  });
});

describe("Content-Range 的拼法只有一处", () => {
  it("partial 写「起点-终点/总长」", () => {
    expect(contentRangeHeader({ start: 0, endInclusive: 99 }, 1000)).toBe(
      "bytes 0-99/1000",
    );
  });

  it("416 那一支只写总长（没有起点终点）", () => {
    expect(contentRangeHeader(null, 1000)).toBe("bytes */1000");
  });
});

describe("大文件与安全整数", () => {
  it("300 MB 量级的成片窗口按字节给（不因为数字大而退化）", () => {
    const big = 300 * 1024 * 1024;
    expect(resolveByteRange(`bytes=${big - 1}-`, big)).toEqual({
      kind: "partial",
      window: { start: big - 1, endInclusive: big - 1 },
    });
  });

  it("超出安全整数的数字算「不解析」，而不是回一个绕回来的窗口", () => {
    // 终点、起点、后缀长度三个位置都要判：它们是同一个「数字不再精确」的故障，
    // 而后缀那一支最容易漏 —— 漏了就会拿一个绕回来的负数去算起点。
    expect(resolveByteRange(`bytes=0-${"9".repeat(20)}`, SIZE)).toEqual({
      kind: "full",
    });
    expect(resolveByteRange(`bytes=${"9".repeat(20)}-`, SIZE)).toEqual({
      kind: "full",
    });
    expect(resolveByteRange(`bytes=-${"9".repeat(20)}`, SIZE)).toEqual({
      kind: "full",
    });
  });
});
