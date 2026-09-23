## Fixed

修正 `docs/standards/07-日志系统.md` 中演示 redact 与镜像文件差异的代码示例：
将占位密钥值 `"MARKER"` 替换为 `"<示例占位值>"`，避免被通用密钥扫描器误报为
「通用密钥」泄露，并同步重新生成 `docs/generated/07-日志系统.md`。

该示例仅用于说明 pino redact 与 ERROR 镜像通道的行为差异，本身不含真实密钥。
