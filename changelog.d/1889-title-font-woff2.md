## Changed

- **内嵌标题字面换载体：`SarasaGothicSC-Bold.ttf`（23,892,196 字节）→ `.woff2`
  （8,624,828 字节，TTF 的 36.1%）**。这是同一份字形的另一种封装，不是另一款字体 ——
  `--font-title` 的首选名、`@font-face` 的 `font-weight: 700`、许可与回退栈一个字没动。
  省下来的字节落在**安装包**上（`public/` 会被 `build-desktop` 整树内嵌进桌包），
  不只是浏览器缓存。
- **`/fonts/:path*` 补 `Cache-Control: public, max-age=31536000, immutable`**。
  Next 对 `/_next/static/**` 自带长缓存，`public/` 下**没有** —— 于是这份 8.6 MB
  此前每次进界面都要重新协商一次。敢标 `immutable` 的前提是「换字面就是换文件名」，
  由 `tests/embedded-title-font.test.ts` 的「CSS 指向的文件必须真在磁盘上」间接钉住。

## Fixed

- **`.gitattributes` 里 `*.woff2` 原本有一条只有 `binary` 的条目**（在「二进制文件
  不转换」那一组里）。git 按「后写胜出」合并、而按行读属性的人取**首条** —— 只加一条
  新规则会让两种读法各得一个答案，而漏掉 `filter=lfs` 的那一端是**静默**的：字体按
  原字节进 git 历史。已合并成一条，并给判据加了「同一个 glob 只许出现一次」。
- `@font-face` 的 `format()` 与文件真实载体改为**逐载体核对**：写成
  `url(x.woff2) format("truetype")` 时 Chromium 照嗅探照解码（`format()` 只是
  「要不要下载」的门），浏览器里一切正常而错的那一端不会喊。

## 验证

- **渲染等价**：Chromium 里同一段中英混排文本用 TTF 与 woff2 各画一遍，截图
  **逐字节相同**（`md5` 相等）；反向对照真跑过 —— 故意把字体文件改名后截图**不同**
  （回退栈的字面肉眼可辨），证明「截图相同」不是空判断。
- **四类变异各跑一次**：`format()` 写错、CSS 退回 `.ttf`、`.gitattributes` 去掉
  `*.woff2` 那条、同一 glob 写两条 —— 全部当场红，恢复后全绿。
