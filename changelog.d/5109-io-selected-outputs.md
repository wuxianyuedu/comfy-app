## Changed
- 产物识别改用**编辑 IO / App Mode 的勾选**作唯一口径（#5109 续）：此前按 class_type 猜「哪些是内部预览节点」，但用户口径是只有勾选为 output 的节点才算输入 / 输出，没勾选的一律不考虑。现在从 `workflowTemplate.workflowIO` 取 `direction:"output"` 条目的运行期节点 id（子图按 `hostNodeId` 拼 `host:inner`），history 里这些节点之外的输出整格跳过——图 / 文本 / 视频 / 音频 / 兜底文件一视同仁，不再多落一条扩写预览 `txt_0.txt`。IO 配置缺失或无勾选时维持旧行为收全部输出，避免没有事实时丢产物；日志仍把「有输出的节点 N 个」与「可下载产物 M 份」分开报。同批补勾选解析、子图拼接、过滤与旧行为回落用例。
