## Added

- **工坊镜头生图支持多张参考图（首张为主图，1~16 张，#4355）**：镜头卡片新增
  参考图多选（草稿只存上传后的文件名，缩略图经 `/api/images?type=input` 回读）；
  留空回落出场角色的定妆照。收集与上传统一走 `prepareShotReferences`（取代
  `preparePortraitReferences`，去掉「只取两张」的旧上限）。
- **执行期图增强（通用注入，不针对单个工作流）**：参考图槽的落点若是**无 widget
  的张量图片入口**（如 MiniMaxH3ImageConditioning 的 `images.image_1..N`），
  执行前自动补一个 LoadImage 装载节点并连到该入口（RAW UI 与 API 两种图格式都
  支持），不再需要在画布里逐个手工加节点；配套把张量图片入口纳入工坊封装的
  连线候选（`pinFamily` 放行 `kind:"param"` 的 IMAGE/MASK 输入）。
- **契约默认参考图槽 2 → 16**：未连线的槽位仍惰性显示「未配置」；工坊生成链路
  现按**生效契约注册表**（含作者在模式契约里的改动）组装载荷
  （`buildLibraryWorkflowInput` 内解析，测试页显式入参优先）。
