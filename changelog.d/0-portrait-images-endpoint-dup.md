## Fixed

- **工坊角色卡定妆照远端生图 404（`/v1/images/images/generations`）**：设置页「远端模型」条目的 Base URL 若已带完整生图路径（…/images/generations）或只到资源段（…/images），服务端仍无条件再拼一次 `/images/generations`，请求打到重复路径被上游以 Invalid URL 拒绝。现在按 Base URL 形态宽容解析：已含动作段原样用、只到资源段补动作段、只到根补全路径（`resolveImagesGenerationsEndpoint`，三种形态均有单测）。
