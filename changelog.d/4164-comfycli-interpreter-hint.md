## Added

- **comfy-cli 解释器填无效路径时的行内提示（ISSUE #4164，#4138 同族）**：设置 →
  创作后端的「comfy-cli 解释器（Python 绝对路径）」填了不存在的路径时，行上
  红色提示「comfy-cli 解释器无效：磁盘上找不到这个文件，请检查盘符与路径」，
  助手文案改说「执行链会失败」，输入框 aria-invalid / aria-describedby 关联
  （规范 §6.8）。留空仍是合法语义（退回默认落点），不提示。
  服务端事实：`comfyInstance` 查询增量透出 `interpreter: { configured, exists }`
  （纯 fs 判定 `describeComfyCliInterpreter`，与 `describeComfyInstance` 同族、
  毫秒级；失焦保存即 refetch 重判）。
