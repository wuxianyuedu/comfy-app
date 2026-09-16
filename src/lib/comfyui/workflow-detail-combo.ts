/**
 * COMBO option resolvers — extracted from workflow-detail.ts (batch 4).
 *
 * ComfyUI COMBO widgets (unet_name / clip_name / vae_name / ckpt_name …)
 * carry NO candidate list in the raw JSON — the only authoritative source
 * is /api/object_info.  We fetch it once per resolver instance (fetchObjectInfo
 * itself caches for 5 min + degrades to null when ComfyUI is unreachable)
 * and resolve `classType + field` → candidate array so the project-canvas
 * form and the subgraph wrapper node can render a real <select> instead of
 * a free-text box.  Missing / unreachable → undefined → graceful fallback
 * to a plain text control.
 */
import { fetchObjectInfo } from "~/lib/comfyui/raw";
import { localModelFileNames } from "~/lib/models";
import { modelFoldersForField } from "~/lib/model-types";

/** Candidate-list extraction from an object_info spec tuple.
 *  旧形态：`[["option-a", "option-b"], {...extra}]`（head 即选项数组）。
 *  新形态（ComfyUI V3 combo，0.13+ 实测）：`["COMBO", {options:[...]}, ...]`
 *  —— head 是类型名字符串，候选挂在第二元素对象的 `options` 字段。
 *  只认这两种；其它类型（FLOAT/INT/STRING 的 spec）返回 undefined。
 *  若只认旧形态，新版服务器的 COMBO 会解析失败，按 class 的候选查询
 *  整体落空，退到 field-name 全库 union——把其它节点同名字段的选项
 *  混进候选表（如 aspect_ratio 混出简写 "16:9"），用户照着选就会提交
 *  服务器不认的值。 */
const comboOptionsFromSpec = (spec: unknown): string[] | undefined => {
  if (!Array.isArray(spec)) return undefined;
  const head: unknown = spec[0];
  if (Array.isArray(head)) {
    const opts = head.filter((x): x is string => typeof x === "string");
    return opts.length ? opts : undefined;
  }
  const extra: unknown = spec[1];
  if (extra != null && typeof extra === "object") {
    const opts = (extra as Record<string, unknown>).options;
    if (Array.isArray(opts)) {
      const list = opts.filter((x): x is string => typeof x === "string");
      return list.length ? list : undefined;
    }
  }
  return undefined;
};

/** Factory that returns fresh object_info-backed resolvers。
 *
 *  The object_info cache lives inside the returned instance (mirroring the
 *  original per-request closure in workflow-detail.ts): each build starts
 *  with a cold `_comboObjectInfo` so a long-lived process never pins a stale
 *  object_info snapshot across requests.
 *
 *  两类解析共用这一次 fetch（同一份对象、同一个缓存）：
 *    · `comboOptionsFor*` —— COMBO 候选表；
 *    · `multilineForClassField` —— STRING 输入是否声明了
 *      `{"multiline": true}`（多行文本框的**类型事实**，见 types.ts 的
 *      `inferIsMultiline`）。 */
export function createObjectInfoResolvers(): {
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
  multilineForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<boolean | undefined>;
} {
  let _comboObjectInfo: Awaited<ReturnType<typeof fetchObjectInfo>> | undefined;
  const ensureObjectInfo = async () => {
    if (_comboObjectInfo === undefined)
      _comboObjectInfo = await fetchObjectInfo();
    return _comboObjectInfo;
  };

  /**
   * Resolve COMBO candidate options for a wrapper widget field.
   *
   * P4: union the node-declared `object_info` candidates with the
   * locally-synced model files that map to this field (e.g. `ckpt_name` →
   * CHECKPOINT files).  ComfyUI's own COMBO list is only ever the default set
   * shipped in object_info; real on-disk models the user installed are NOT
   * listed there, so without the union the canvas dropdown silently misses
   * every local model.  Both sources are returned verbatim (extension kept)
   * and de-duplicated + sorted; if neither yields anything we return
   * `undefined` so the consumer falls back to a plain text control.
   */
  /** 某 class 某字段在 object_info 里的原始 spec（`[类型, 选项对象, …]`）。
   *  查不到（未注册 / 该字段不存在 / ComfyUI 未启动）时 undefined。 */
  const specForClassField = async (
    classType: string | undefined,
    field: string,
  ): Promise<unknown> => {
    if (!classType) return undefined;
    const oi = await ensureObjectInfo();
    if (!oi) return undefined;
    const def = oi[classType];
    if (!def?.input) return undefined;
    return def.input.required?.[field] ?? def.input.optional?.[field];
  };

  const comboOptionsForClassField = async (
    classType: string | undefined,
    field: string,
  ): Promise<string[] | undefined> => {
    const [specOpts, localOpts] = await Promise.all([
      (async () =>
        comboOptionsFromSpec(await specForClassField(classType, field)))(),
      localModelFileNames(modelFoldersForField(field)),
    ]);

    const merged = new Set<string>();
    if (specOpts) for (const o of specOpts) merged.add(o);
    for (const o of localOpts) merged.add(o);
    const out = Array.from(merged);
    return out.length
      ? out.sort((left, right) => left.localeCompare(right))
      : undefined;
  };

  /**
   * Fallback COMBO resolver used when the class-based lookup yields nothing —
   * e.g. a `comfy-core` subgraph node (v0.7.0) whose `properties.proxyWidgets`
   * is absent or quarantined, so we never learn the internal node's class and
   * `comboOptionsForClassField(wrapperClass, field)` can't find the field.
   *
   * Scans EVERY `object_info` class that declares `field` as a COMBO and unions
   * their candidate lists.  For uniquely-named fields (e.g. `resolution_preset`,
   * declared by exactly one class) this recovers the full option list; for
   * shared model fields (e.g. `unet_name`) it unions all known defaults, which
   * is harmless because the local-model union below already covers the
   * realistic on-disk set.  object_info is fetched once and cached, so the
   * scan is cheap on repeated calls.
   */
  const comboOptionsForFieldName = async (
    field: string,
  ): Promise<string[] | undefined> => {
    const oi = await ensureObjectInfo();
    if (!oi) return undefined;
    const merged = new Set<string>();
    let found = false;
    for (const def of Object.values(oi)) {
      const inp = def.input;
      if (!inp) continue;
      const spec = inp.required?.[field] ?? inp.optional?.[field];
      const opts = comboOptionsFromSpec(spec);
      if (opts) {
        found = true;
        for (const o of opts) merged.add(o);
      }
    }
    if (!found) return undefined;
    for (const o of await localModelFileNames(modelFoldersForField(field)))
      merged.add(o);
    const out = Array.from(merged);
    return out.length
      ? out.sort((left, right) => left.localeCompare(right))
      : undefined;
  };

  /** STRING 输入是否声明了 `{"multiline": true}`（多行文本框的类型事实）。
   *
   *  与 COMBO 候选读的是同一份 object_info 缓存，所以每个请求仍只 fetch 一次。
   *  查不到时返回 `undefined`（而不是 false）：调用方据此退回「值很长」这条
   *  数据判据，不会因为「没查到声明」就把长文本框降级成单行。 */
  const multilineForClassField = async (
    classType: string | undefined,
    field: string,
  ): Promise<boolean | undefined> => {
    const spec = await specForClassField(classType, field);
    if (!Array.isArray(spec)) return undefined;
    const extra: unknown = spec[1];
    if (extra == null || typeof extra !== "object") return undefined;
    return (extra as Record<string, unknown>).multiline === true;
  };

  return {
    comboOptionsForClassField,
    comboOptionsForFieldName,
    multilineForClassField,
  };
}
