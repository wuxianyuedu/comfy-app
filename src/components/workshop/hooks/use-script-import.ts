"use client";

// 剧本文件导入（#4827）：「导入剧本」按钮与拖拽投放区两个入口共用的漏斗 ——
// 扩展名守卫、读文本、非空才覆盖；空文件 / 读取失败 / 扩展名不匹配一律
// showNotice 且保留现有剧本。隐藏 input 与「选完复位 value」的样板收进
// `ui/file-picker`；拖拽漏斗收在 `ui/use-drop-zone`（与工作流库导入同一份）。
// （#4834 后从 WorkshopStageBody 再抽出：主函数长度硬闸，按职责切子 hook。）

import { useDropZone } from "~/components/ui/use-drop-zone";
import { useFilePicker } from "~/components/ui/file-picker";
import { readFileAsText } from "~/lib/file-io";

export function useScriptImport(opts: {
  setScriptMarkdown: (text: string) => void;
  showNotice: (message: string) => void;
}): {
  scriptDropZone: ReturnType<typeof useDropZone>;
  scriptPicker: ReturnType<typeof useFilePicker>;
} {
  const { setScriptMarkdown, showNotice } = opts;

  const handleScriptFile = (file: File) => {
    /* 与 file-picker 的 accept 同一口径：拖拽没有 accept 可挡，得在漏斗里守。
     * 不匹配不覆盖 —— 与空文件 / 读失败同一条「保留现有剧本」的纪律。 */
    if (!/\.(?:md|txt)$/i.test(file.name)) {
      showNotice(`「${file.name}」不是 .md / .txt 文件，已保留当前剧本`);
      return;
    }
    /* 读取统一走 `~/lib/file-io`（§16.2.4.27）：`file.text()` 的 rejection
     * 此前在这里被吞掉，「选了个读不了的文件」与「选了个空文件」在界面上
     * 长得一样。 */
    void readFileAsText(file)
      .then((text) => {
        if (text.trim()) {
          setScriptMarkdown(text);
        } else {
          showNotice(`「${file.name}」没有可导入的内容，已保留当前剧本`);
        }
      })
      .catch(() => {
        /* 读取失败不得清空已有剧本（旧实现把 scriptMarkdown 覆盖成空串，
         * 一次坏文件就毁掉整份剧本）。降级不得静默（规范 10 §10.3.1）：
         * 说清发生了什么、内容没有丢。 */
        showNotice(`「${file.name}」读取失败，已保留当前剧本内容`);
      });
  };

  const scriptPicker = useFilePicker({ accept: ".md,.txt", onPick: handleScriptFile });

  /* 拖拽投放区：剧本阶段整页（空态与已有剧本态）都收；错误话术走本屏的
   * notice 条 —— 与按钮导入同一出口。 */
  const scriptDropZone = useDropZone(handleScriptFile, showNotice);

  return { scriptPicker, scriptDropZone };
}
