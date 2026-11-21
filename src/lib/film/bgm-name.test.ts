/** `bgm-name` 判据测试（#4738）：合法名 = 上传口生成的单段文件名；
 *  分隔符 / 根定位符 / 超长一律拒绝 —— composeFilm 拿它进 ffmpeg 输入前，
 *  路由与合成侧共用这一份判据。 */
import { describe, expect, it } from "vitest";

import { isSafeBgmName } from "./bgm-name";

describe("isSafeBgmName", () => {
  it("上传口生成的单段文件名放行（含 CJK 展示名与含点名）", () => {
    expect(isSafeBgmName("bgm-1730000000_雨声.mp3")).toBe(true);
    expect(isSafeBgmName("bgm-1_a..b.wav")).toBe(true);
  });

  it("路径分隔符与根定位符一律拒绝（含 Windows 反斜杠）", () => {
    const bad = ["../../x.mp3", "a/b.mp3", String.raw`a\b.mp3`, "/abs.mp3", "..", ".", ""];
    for (const name of bad) {
      expect(isSafeBgmName(name), `bgmName=${name}`).toBe(false);
    }
  });

  it("超长名拒绝", () => {
    expect(isSafeBgmName(`${"a".repeat(256)}.mp3`)).toBe(false);
  });
});
