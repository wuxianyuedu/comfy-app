## Changed

按「同一件事的多种写法」再扫一轮，三条账各收成一处实现，三条判据都是硬闸（P47/P48/P49）：

- **「扩展名 ⇄ MIME 类型」→ `~/lib/media/mime-ext`**。同一件事此前有 **6 份互不相同的
  映射表**，而它们**互相矛盾** —— `image/avif` 只在一半表里有、`image/webp` 在一条里缺，
  而 `api/generated` 那份还多背了 `text/plain` / `application/json`（它服务的是磁盘上的
  任意产物文件）。同一个上传文件在「走 `resolveMediaBytes` 兜底」与「走 prepare 路由
  落盘」两条路径上会得到不同的扩展名与 Content-Type。出口给两张**手写**表（`jpeg`/`jpg`
  映到同一个 MIME，反转会产出不确定的结果）+ `extOfPath` / `stemOfPath` 两个取段助手
  + `contentTypeForPath`（媒体之外的档收在一处，「谁是媒体」只有一处定义）。
  **兜底值不塞进出口**：`?? "png"` 是「当图片存」、`?? "application/octet-stream"` 是
  「我不知道」，两件事不该共用一个默认值。
- **「`unknown` 当宽松对象视图读」→ `~/lib/is-record` 的 `asRecord`**。收口前有 **4 份**
  实现，而**名字各不同、其中一份与另一份同名不同义**：`workflow-utils` 与
  `lib/comfyui/raw` 都叫 `asRecord`；`api-channel-core` **叫 `isPlainRecord` 却不排除
  数组**（与 `~/lib/is-record` 的严格版同名不同义 —— 按名字理解就会拿到意外的收窄结果）；
  `use-param-wiring` 的 `isPlainRecord` 真排除数组。出口把三个语义分开：
  `isRecord`（含数组）/ `isPlainRecord`（非数组）/ `asRecord`（转成视图或 `null`）。
- **「把一段文本变成安全的文件名片段」→ `~/lib/safe-name`**。同一件「非法字符换成 `_`」
  有 **4 份各不相同的正则**，差异没有一处写下来：一份留点留 CJK、一份**吃掉点**
  （`v1.2` → `v1_2`）、两份**吃掉 CJK**。同一个中文名在 bgm 上传路径被保留、在工坊产出
  目录被替换成下划线。出口给两个具名档：`safeFileNameSegment`（ASCII 片段，进 ComfyUI
  子目录 / URL 路径）/ `safeDisplayName`（额外保留 CJK，给用户认的名字）；
  `~/lib/media/materials` 的 `sanitizeFileName` **不并入** —— 那是「这个名字能不能用」，
  与本模块的「把坏字符换掉」是两件事。

### Fixed

- **`api/film/bgm/route.ts` 的落盘文件名后缀重复**：收口前写的是 `${safe}${ext}`，而
  `safe` 仍是**含后缀的整名**（`bgm.mp3` + `.mp3` → `bgm.mp3.mp3`）。那个 `|| ".mp3"`
  只在 `file.name` **没有点**时才被用上，所以这条一直在但没人看见。新增的 `stemOfPath`
  正是为「展示名 + 后缀分开放」准备的，顺手修掉。
- 排除了 `api/generated` 的 `MIME_BY_EXT` / `workshop-local/prepare` 的 `extForMime`
  两份表里「同上但更小」的覆盖面分叉：现在两条路径对同一个 `image/avif` 给出同一个答案。

判据：`check-ui-primitives.cjs` 新增 P47/P48/P49（硬闸，扫 `src/components` / `src/app`
/ `src/lib` / `src/server`），13 条契约用例（各判据阻断、合规不误伤、**边界不误伤** ——
P48 刻意不数「就地读一个字段」与「取反早退守卫」两种形态，第一版把它们算进来实测报出
24 处、一半是这两类）。新增 `mime-ext.test.ts`（16 条）/ `safe-name.test.ts`（7 条），
两个出口同批登记 `coverage.include` + `thresholds`。

规范同步 `16 §16.2.3`（判据表）+ `§16.2.4.51 ~ §16.2.4.53`（三条台账）。

行为不变：「只搬定义、不动取值」，除上面两处已写明的修复外，各落点的扩展名、MIME、
文件名形态一字未改。
