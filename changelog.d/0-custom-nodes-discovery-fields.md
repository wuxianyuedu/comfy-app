## Fixed

- **「导入自定义节点」里所有子包都标成「目录不存在」**：解析器（`scripts/parse_custom_nodes.py`）的发现模式只回 `{name, path}`，而路由与界面要的是带 `exists / isLeaf / fileCount / packageFileCount / sizeBytes / contentHash / status` 的完整记录，于是每个子包都因为 `exists` 缺失被判成「目录不存在」、按钮一律「无法解析」；同一处还丢了「扫描 / 哈希」两阶段进度行（脚本改用 JSON 前缀，路由解析的是文本格式，进度条不再动）。现恢复被替换成简化版的解析器：52 个子包重新正确显示「已加载 / 未导入 / 待更新」，进度条两阶段恢复；解析模式同时恢复 INPUT_TYPES / RETURN_TYPES 等接口提取，清单里的节点类型与数量重新有值（此前只有类型名、`总节点数` 恒为 0）。
