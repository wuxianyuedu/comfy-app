// ── 「读取用户选的本地文件」的唯一出口（规范 16 §16.2.4.27）────────────────
//
// 按**形态**扫描时撞出来的账：全库 6 处各写一遍「把 File 读成文本 / data URL」，
// 而它们对三件事各判各的：
//
//   ① **怎么读** —— 4 处走 `file.text()`（Promise 形态，自带拒绝），
//      2 处手搓 `new FileReader()` + `onload` / `onerror` 包一层 Promise；
//   ② **读空/读到怪东西算什么** —— 两处 FileReader 版本各自写
//      `typeof reader.result === "string" ? reader.result : ""`，而**空串
//      与真失败被压成同一个值**：`prepareLocalInputImage` 那侧只能靠
//      `if (!dataUrl) throw` 反推，另一侧直接把空串当图片地址往下传；
//   ③ **失败怎么说** —— 三处文案各不相同（「读取图片失败」/「读取本地图片失败」/
//      调用处自己拼 `无法读取文件：<原始 message>`）。
//
// 这条账的形状与 `display-value` / `list-filter` 同族：**不是重复代码，是判据**
// —— `file.text()` 与 `FileReader` 都编译、都运行，差别只在「读到空内容算不算
// 失败」「失败时是不是抛出」这两个语义决定上，而它们散在 6 处就永远不会被
// 统一说出来。
//
// 与 `~/lib/browser-io` 的分工：那个管「把一段文本**送出去**」（剪贴板 / 下载），
// 本模块管「把用户选的东西**读进来**」。两者同属「浏览器侧的输入输出」，
// 但方向相反，所以是两个模块而不是一个 —— 合成一个会让「只读文件」的调用处
// 连带引入剪贴板实现（P5/P6 的判据也就分不开了）。

/**
 * 把用户选的文件读成文本（UTF-8）。
 *
 * **失败一律抛出**（不返回空串）：读不到内容的后果，调用处必须能区分
 * 「文件是空的」与「读失败了」—— 此前那两处 FileReader 实现把它们压成同一个
 * `""`，于是「读取失败」在界面上表现为「文件内容为空」。抛出的 message
 * 是可直接展示的中文文案，`cause` 保留原始错误。
 *
 * `file.text()` 在权限不足 / 文件已被移走时会拒绝；但在**不支持** Blob 文本
 * 接口的老宿主里它可能根本不存在 —— 因此这里备了 `FileReader` 通道，
 * 与剪贴板的「两条通道」同款取舍。
 */
export async function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      /* `readAsText` 的结果必是字符串；读到非字符串（老宿主 / 被替换的
       * result）等同于读失败，不要静默返回 `""` —— 那会让「读坏了」
       * 看起来像「文件是空的」。 */
      if (typeof result !== "string") {
        reject(new Error("读取文件失败"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () =>
      reject(new Error("读取文件失败", { cause: reader.error }));
    reader.readAsText(file);
  });
}

/**
 * 把用户选的图片文件读成 data URL（`data:image/...;base64,...`）。
 *
 * 用于「不回服务端的纯前端转码」：ComfyUI 的图片准备接口认这一种来源。
 *
 * **空结果视为失败并抛出**：data URL 不可能为空串，拿到空值只可能是读失败 ——
 * 返回 `""` 会让调用处把空串当图片地址往下传（此前一处正是这样，靠调用方
 * 自己 `if (!dataUrl) throw` 兜住，另一处直接把空串发给了上传接口）。
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    /* 无 `FileReader` 的环境（SSR / 被替换的宿主）直接拒绝，而不是让
     * `new FileReader()` 抛 ReferenceError 成为未捕获异常。这条守卫随
     * 「读进来」能力归位本模块（此前它散在 browser-io 的重名实现里）。 */
    if (typeof FileReader === "undefined") {
      reject(new Error("当前环境不支持读取文件"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || result === "") {
        reject(new Error("读取本地图片失败"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () =>
      reject(new Error("读取本地图片失败", { cause: reader.error }));
    reader.readAsDataURL(file);
  });
}
