/**
 * cnb-fields 自测（ISSUE #3060）：信封解包与字段读取的**单一出处**。
 *
 * 三条契约在这里钉死：
 *   ① 结论只认 `data` 里的键 —— 信封顶层（HTTP `status`）不参与；
 *   ② 「data 缺键」与「信封形状不对」是两种 `ok:false`，原因不同——
 *      从前它们在读数上长得一样，人核对时无法判断是字段真缺了还是拆错了层；
 *   ③ 清单端点的三种形状（`data` 数组 / `data.data` 数组 / 裸数组）收成一份记录数组。
 */
import { describe, expect, it } from "vitest";

import { cnbData, cnbRecords, readCnbField } from "../scripts/cnb-fields.mjs";

describe("cnb-fields —— 信封解包（结论只认 data 里的键）", () => {
  it("正常信封：读 data 里的键", () => {
    const json = { status: 200, data: { is_merged: true, number: 2982 } };
    const isMerged = readCnbField(json, "is_merged");
    expect(isMerged.ok).toBe(true);
    expect(isMerged.ok && isMerged.value).toBe(true);
    const number = readCnbField(json, "number");
    expect(number.ok && number.value).toBe(2982);
  });

  it("data 缺键 ⇒ ok:false 且原因点名缺的是哪个键（不是拆错层）", () => {
    const json = { status: 200, data: { author: {}, head: {} } };
    const got = readCnbField(json, "is_merged");
    expect(got.ok).toBe(false);
    expect(got.ok === false && got.reason).toBe("data 缺键 is_merged");
  });

  it("信封形状不对（data 缺失 / 不是对象 / 裸数组）⇒ 另一种 ok:false", () => {
    for (const json of [null, undefined, 42, { status: 200 }, { data: "oops" }, [1, 2]]) {
      const got = readCnbField(json, "is_merged");
      expect(got.ok).toBe(false);
      expect(got.ok === false && got.reason).toBe("信封形状不对（data 缺失或不是对象）");
    }
  });

  it("cnbData：信封解包只交 data 那一层；HTTP status 不参与", () => {
    const data = cnbData({ status: 200, data: { state: "open" } });
    expect(data).toEqual({ state: "open" });
    /* HTTP 200 不构成「结论对了」—— 结论只认 data。 */
    expect(cnbData({ status: 200 })).toBeNull();
  });
});

describe("cnb-fields —— 清单端点的三种形状收成一份记录数组", () => {
  it("单层 data 数组", () => {
    const json = { data: [{ number: 1 }, { number: 2 }] };
    expect(cnbRecords(json)).toHaveLength(2);
  });

  it("分页双层 data.data 数组（ISSUE #3060 现场的另一形状）", () => {
    const json = { data: { data: [{ number: 1 }], has_more: false } };
    expect(cnbRecords(json)).toHaveLength(1);
  });

  it("裸数组（cnbJson 直接拿到清单）", () => {
    expect(cnbRecords([{ number: 1 }])).toHaveLength(1);
  });

  it("形状都不对 ⇒ 空数组（调用方按各自三态报，不冒充「没有」）", () => {
    expect(cnbRecords(null)).toEqual([]);
    expect(cnbRecords({ data: "oops" })).toEqual([]);
  });
});
