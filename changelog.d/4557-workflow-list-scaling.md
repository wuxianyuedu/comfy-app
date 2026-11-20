## Changed

- 工作流列表随库规模线性变慢的三段修复（#4557）：列表投影不再拉 `rawJson` 大列
  （单行可达数 MB），「RAW 原件有内容」改为写入时物化的 `hasRaw` 列（存量行由
  列表查询按用户惰性回填一次）；`workflow.list` 不再对每行做整图 JSON 解析与
  预览构建（核对后该预览字段全仓零消费，随本单移除）；库列表视图窗口化渲染
  （@tanstack/react-virtual，与 NodesTab / ModelLibrary 同款），只挂载视口内行。
  实测 46 行（40 行 × 48KB rawJson）列表请求 187ms、载荷不再含 rawJson。
