## Fixed

- **「测试生成」对供应商模型不再发出无密钥请求**（ISSUE #3577 评论 4 的现场：
  `HTTP 401 … "Token not provided"`，地址对、密钥丢）。根因在「实际调用测试」两个路由
  共用的连接解析（`resolveUpstream`）：它的回落链只到 `llmConfig.extraModels`（旧表）
  与全局密钥，而 #3501 之后模型挂在 `llmProvider` 下、条目自身不带密钥——`getLLMConfig`
  读库一旦瞬时失败（SQLite busy 时 catch 吞掉回落 env），条目整体缺席，请求就静默裸发。
  修法是解析链里加一道**供应商链直查**（`remoteModel → llmProvider`，独立于
  `getLLMConfig` 的一轮，地址与密钥都兜回），且密钥全空、模型确属某供应商而该供应商
  又没配密钥时，直接给「供应商未配置 API 密钥」的可读报错，不再让上游替我们说谜语。

## Changed

- **远程模型设置页按 #3577 评论逐条整改**：
  - 用途词表改「文本 / 图像 / 视频」（存储值 chat / image / video 不变，纯界面词）；
  - 模型弹窗新增**输出类型**（`remoteModel.outputTypes`，词表 text / image / video），
    「智能配置」按模型名推断（agnes-image-* → 图像、*-video-* → 视频）；
  - 「高级配置」可折叠（新增默认收起、编辑默认展开），多选 chip 的选中态改品牌色
    描边 + 15% 品牌底（暗色主题下与未选拉开一档）；
  - 供应商「测试连接」成功后把服务端模型目录**补进名下**（`syncProviderCatalog`）：
    已有名字一行不动，缺的插成停用行——「获取到的模型全部显示出来，默认关闭状态」；
  - 「智能配置」新增 agnes 家族规则（512K 窗口 / 65,536 输出），上下文窗口留空时的
    提示改为常见值区间；
  - Agnes 视频的测试端点默认 `/v1/videos`（任务制），任务 ID 抽取认原生键 `video_id`。
- `remoteModel` 新增 `outputTypes` 列（迁移 `drizzle/0002_*.sql`，同时补齐 #3501 以来
  落后的版本化快照；既有库由启动链路的 `db:push` 同步，行为不变）。
