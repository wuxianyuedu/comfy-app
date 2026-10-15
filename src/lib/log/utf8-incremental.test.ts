import { describe, expect, it } from "vitest";

import { decodeIncremental, incompleteTailLength } from "./utf8-incremental";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("跨块的多字节字符不许被劈成两半（ISSUE #1959 的乱码根因）", () => {
  it("整块完整时尾巴为 0（不引入任何延迟）", () => {
    expect(incompleteTailLength(enc("hello"))).toBe(0);
    expect(incompleteTailLength(enc("中文完整"))).toBe(0);
    expect(incompleteTailLength(new Uint8Array(0))).toBe(0);
  });

  it("切在 3 字节中文字符中间：末尾残留 1 / 2 个字节", () => {
    const full = enc("中"); // E4 B8 AD
    expect(incompleteTailLength(full.subarray(0, 1))).toBe(1);
    expect(incompleteTailLength(full.subarray(0, 2))).toBe(2);
    expect(incompleteTailLength(full)).toBe(0);
  });

  it("切在 4 字节 emoji 中间：末尾残留 1~3", () => {
    const full = enc("😀"); // F0 9F 98 80
    for (let n = 1; n <= 3; n++) {
      expect(incompleteTailLength(full.subarray(0, n))).toBe(n);
    }
    expect(incompleteTailLength(full)).toBe(0);
  });

  it("**反向验证**：逐字节喂一个中文串，拼到最后必须逐字复原（旧实现每段各自 toString 会出 U+FFFD）", () => {
    const source = "开始加载模型 中文与 emoji 😀 共存\n第二行\n";
    const bytes = enc(source);
    let carry: Uint8Array = new Uint8Array(0);
    let out = "";
    for (const byte of bytes) {
      const r = decodeIncremental(carry, new Uint8Array([byte]));
      out += r.text;
      carry = r.carry;
    }
    /* 收尾：最后一轮若还留着残余（源串本身不完整才会），这里源串是完整的，
     * 所以 carry 必须为空 —— 这条同时钉住「不会把完整字符误留成残余」。 */
    expect(carry.length).toBe(0);
    expect(out).toBe(source);
    expect(out).not.toContain("\uFFFD");
  });

  it("按**任意**切点切分都能复原（不是只对某一种切法成立）", () => {
    const source = "加载 100% 完成（中文）😀\n";
    const bytes = enc(source);
    /* 枚举全部「两刀」切法：三段各自都不完整的情形覆盖到了。 */
    for (let a = 0; a <= bytes.length; a++) {
      for (let b = a; b <= bytes.length; b++) {
        let carry: Uint8Array = new Uint8Array(0);
        let out = "";
        for (const seg of [
          bytes.subarray(0, a),
          bytes.subarray(a, b),
          bytes.subarray(b),
        ]) {
          const r = decodeIncremental(carry, seg);
          out += r.text;
          carry = r.carry;
        }
        expect(out + new TextDecoder().decode(carry)).toBe(source);
        expect(out).not.toContain("\uFFFD");
      }
    }
  });

  it("真正的非法字节照样如实报坏（本模块只负责「不自己制造乱码」）", () => {
    /* 一个孤立的续字节：不是被截断，而是根本不是合法 UTF-8。
     * 它不该被当成「等下一块」永久留下去。 */
    const bad = new Uint8Array([0x41, 0xff, 0x42]);
    expect(incompleteTailLength(bad)).toBe(0);
    const r = decodeIncremental(new Uint8Array(0), bad);
    expect(r.carry.length).toBe(0);
    expect(r.text.startsWith("A")).toBe(true);
  });

  it("残余不跨轮丢失：上一轮留下的半个字符与这一轮的后半截拼得上", () => {
    const full = enc("中文");
    const r1 = decodeIncremental(new Uint8Array(0), full.subarray(0, 4));
    expect(r1.text).toBe("中");
    expect(r1.carry.length).toBe(1);
    const r2 = decodeIncremental(r1.carry, full.subarray(4));
    expect(r2.text).toBe("文");
    expect(r2.carry.length).toBe(0);
  });
});
