// ── 「把一段用户/上游给的文本变成安全的文件名片段」的唯一出口（规范 16 §16.2.4.53）──
//
// 按**形态**扫描撞出来的账（ISSUE #672）：同一件「非法字符换成 `_`」在全库有
// **五份各不相同的实现**，而它们的差异**没有一处写下来**：
//
//   api/film/bgm/route.ts        `replace(/[^\w.\-一-龥]/g, "_").slice(0, 60)`
//                                —— 保留点、保留 CJK、截到 60
//   lib/comfyui/trainer.ts       `replace(/[^\w一-龥-]+/g, "_")`
//                                —— 不保留点！（Lora 名里的 `.` 会被吃掉）
//   server/workshop/comfyui.ts   `replace(/[^\w.-]/g, "_")`   ×2
//                                —— 保留点、**不吃 CJK**
//
// 三处的差异不是「覆盖面不同」而是**互相矛盾**：同一个中文名在 bgm 上传路径
// 里被保留、在工坊产出目录里被替换成下划线；同一个带点的名字在工坊里保留点、
// 在 Lora 文件名里把点吃掉（`v1.2` → `v1_2`，与另一条路径产出的名字对不上）。
//
// 收口口径（与 §16.2.4.48 的截断同款）：**「保留哪些字符」是各域的域需求，
// 该有各自的名字**，但「有一件事在把非法字符换成 `_`」这个形状只该有一处定义。
// 因此出口给的是一组**具名档**，每档带一句「为什么是这些字符」：
//
//   · `safeFileNameSegment` —— 通用片段：字母数字 / 下划线 / 连字符 / 点，
//     **不含 CJK**（进 URL 路径、ComfyUI 子目录名等下游只认 ASCII 的地方）；
//   · `safeDisplayName` —— 保留 CJK 的展示名（用户上传的音乐、Lora 名），
//     写进磁盘文件名 —— 但那台机器上谁读它都是同一个人，CJK 保留才有意义；
//   · `sanitizeFileName`（`~/lib/media/materials`）**不并入本模块** —— 它做的是
//     另一件事（剥目录成分 + 防 Windows 保留字符 + 长度判据 + 返回 `null` 表示
//     拒绝），语义是「这个名字能不能用」而不是「把坏字符换掉」。
//
// 一句话判据：**要「换掉坏字符」用本模块；要「这个名字能不能用」用 materials。**

/** 通用安全片段：只留 ASCII 字母数字、下划线、连字符、点；其余换成 `_`。
 *
 *  为什么不留 CJK：本档的消费方是 **ComfyUI 子目录 / 输出文件名 / URL 路径** ——
 *  这些下游由 Python 侧与浏览器各自解码，中文名在不同宿主的编码/规范化
 *  （NFC vs NFD、Windows 的 GBK 回退）下不保证往返一致。ASCII 片段是唯一
 *  确定性的形态。**要给用户看的名字不要走这里**（那走 `safeDisplayName`）。 */
export function safeFileNameSegment(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^\w.-]+/g, "_");
}

/** 展示名片段：在 ASCII 片段的基础上**额外保留 CJK**（中文/日文/韩文）。
 *
 *  用于「这个名字要落成磁盘文件名，且用户会按它认人」的场合（上传的 BGM、
 *  Lora 训练产物）。保留 CJK 是有意的：把「背景音乐.mp3」存成
 *  「______.mp3」之后，用户在文件管理器里再也认不出它。 */
export function safeDisplayName(raw: string | null | undefined): string {
  if (!raw) return "";
  /* `\u4e00-\u9fa5` 是「基本汉字区」—— 与全库既有的两处 CJK 判据同口径
   *（收口前 `bgm` 与 `trainer` 各写了一遍这个区间）。 */
  return raw.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_");
}
