## Changed

- 按形态扫描继续清账（ISSUE #672，规范 16 §16.2.4.45 ~ §16.2.4.47），
  三条新判据 **P42 / P43** 一上来就是硬闸，第三条刻意不做门禁：
  - **错误文案的「动作前缀」**（判据跑出 42 处 → 0）：`~/lib/error-message` 的
    `errorMessage` 早已是「详情」那一半的唯一出口，但「是哪个动作失败了」那一半
    有四种写法并存（模板串硬拼 / `+` 拼 / **绕开 `errorMessage` 的 `String(e)`** /
    动作名当 fallback）。新增 `errorText(e, action, fallback?)`：动作名与详情两段式，
    分隔符只有一处定义，`fallback` 只兜详情（裸调 `errorMessage(e, "保存失败")`
    在取不到 message 时会把动作名当详情，于是「保存失败：保存失败」）。
    判据比人工梳理多找到 20+ 处 —— `src/lib/**` 里 `app-update-client` /
    `api-channel-core` / `comfyui/*` 六处 / `drizzle-studio/lifecycle` /
    `open-in-browser` / `media-source.server` / `final-compose` / `comfy-embed` /
    `importSource` 都用同一个 `instanceof Error ? e.message : String(e)` 兜底，
    它不只是拼串：`String(e)` 对 `new Error("")` 产出 `"Error"`、对对象抛值产出
    `"[object Object]"`，且**绕过网络层翻译**。**P42 硬闸**。
  - **复制失败的固定提示句**（10 个落点 / 5 种变体 → 0）：`~/components/ui/use-copy-feedback`
    新增 `copyFailureText(target?)`。收口前 10 处各手写同一句话，写法有
    `请手动选中后复制` ×5、`请手动选中复制` ×1（**漏了「后」**）、
    `请在下方展开后手动选中复制` ×2、`请手动选中日志后复制` ×1、
    `请到创作台手动重跑` ×1 —— 「浏览器为什么拒绝写剪贴板」这件事说了五种说法。
    固定句走出口、「可复制物在哪一段界面里」（只有调用处知道）经参数注入。
    **P43 硬闸**。
  - **列表项的 React key 用下标**（1 处真修）：`UsageTestDialog` 拿
    `fields.indexOf(f)` 反查下标当 `key`，删中间一行时后面所有行的下标整体左移，
    React 复用错误的 DOM 节点 —— 用户在某行刚输入的内容会「闪到隔壁字段」。
    `UsageField` 增加 `id`（**不参与序列化**，`usageFieldsToJson` 只读 `key` / `value`），
    由新增的 `makeUsageField` 一处生成。**刻意不做门禁** —— 机器判不出
    「这个 list 会不会换序」，而 `key={i}` 在「静态切段」里是正确写法；
    判据落在能判的那一半（`usage-field-editor.test.ts` 断言删行后其余行的 `id` 逐个不变）。
