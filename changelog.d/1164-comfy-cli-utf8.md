## Fixed

- **执行日志里 comfy-cli 回传的中文不再是乱码**（ISSUE #1164，先于本工作线存在，3-C 真机端到端时记下）。根因不在 Node 的解码，而在 **Python 那侧的默认编码**：中文 Windows 的 ANSI 代码页是 GBK/CP936，Python 在非 ASCII locale 下 `sys.stdout` 与 `open()` 都跟着 locale 走。实测三态（用 comfy-cli 那份解释器）：不注入 → `sys.stdout.encoding = gbk`、回传原文按 UTF-8 强解解不动；只给 `PYTHONIOENCODING=utf-8` → stdio 好了，但 `open()` 仍按 GBK 读我们写出去的 UTF-8 工作流文件，直接 `UnicodeDecodeError` 退出 1；给 `PYTHONUTF8=1` → 两边都对。
  - 所以 issue 里那句「倾向候选 1：`PYTHONIOENCODING` 最小」被实测否掉 —— 它是**半个修复**，而且留下的是更坏的那一半（显示好看，读文件照样崩）。落地两个键都给：`PYTHONUTF8=1`（UTF-8 模式，管全局含文件读）+ `PYTHONIOENCODING=utf-8`（再显式钉死 stdio），与 `lifecycle-launch.ts` 给 ComfyUI 本体那一份**同形**（那里早为「自定义节点 print 一个 emoji 就把进程打崩」立过这条口径），不新造约定。
  - 候选 2（Node 侧按代码页解）没采纳：那是又造一处平台分叉（本仓平台判据只许收在两处），而且它同样救不了 `open()` 那条崩路径。
- **这条的影响面是「取证现场被写坏」，不只是好看**：两跑真生成的终态都是 `SUCCEEDED`，坏的是 `[comfy-cli 原始]` / `prompt_preview` 这些本该回答「ComfyUI 到底收到了什么」的原文 —— 中文那一半是废字节时，看日志的人分不清是用户提示词本来就怪、还是我们转手弄坏的。A/B 同一条工作流、各自打掉执行缓存：修前那句带唯一标记的中文提示词在 `rawCli` 里**复原不了**（`柴犬` 一处都没有，留 16 个 U+FFFD），修后原样活着（U+FFFD 归 0）；两跑里我们自己拼的日志行都是好的，这正说明坏的只可能是对侧回传的那一段。

## Tests

- 新增 `tests/comfy-cli-python-utf8.test.ts` 三条（先剥注释再匹配，用的是 #1284 那条台账刚推广的共享件）：comfy-cli 的 spawn `env` 字面量里两个编码键都在（顺带钉住同块的 `PYTHONUNBUFFERED`，那是 #1184 的兄弟判决）；两条管道都**显式** `setEncoding("utf-8")`（写侧锁了、读侧漂掉同样是乱码）；`lifecycle-launch.ts` 保持同一口径（防止那两个键被当历史包袱清掉）。
- 判据自己也被验过会红：只删 `PYTHONUTF8`、留 `PYTHONIOENCODING`（正是那个「半个修复」的形状）→ 第一条红。
- 一处选择器上的自我订正：第一版用「含 `PYTHONUNBUFFERED` 的 env 块」定位，把 ComfyUI 那条链路直接判成「找不到」（它那一份叫 `stdioEnv`，也没有 `PYTHONUNBUFFERED`）—— 改成按大括号配平扫 `env` / `stdioEnv` / `childEnv` 再挑装着 `PYTHON*` 键的那一个。

## Docs

- ADR **§25** 记本刀：三态实测表、被否掉的「修法候选 1」与候选 2、A/B 真机读数、判据的选择器教训。
- 灰度指南 `docs/guide-executor-host.md` 的「已知观察项」第 2 条从「待治理（修向 `PYTHONIOENCODING=utf-8`）」改成已修 + 机制 + 「只给一个键是半个修复」这一手，别让下一个人照旧写法停在那儿。
