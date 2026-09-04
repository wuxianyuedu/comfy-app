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
import { fetchObjectInfo } from "@/lib/comfyui/raw";
import { localModelFileNames } from "@/lib/models";
import { modelFoldersForField } from "@/lib/model-types";

/** Candidate-list extraction from an object_info spec tuple:
 *  `[["option-a", "option-b"], {...extra}]` → string list. */
const comboOptionsFromSpec = (spec: unknown): string[] | undefined => {
  if (!Array.isArray(spec)) return undefined;
  const head: unknown = spec[0];
  if (!Array.isArray(head)) return undefined;
  const opts = head.filter((x): x is string => typeof x === "string");
  return opts.length ? opts : undefined;
};

/** Factory that returns a fresh COMBO resolver closure.
 *
 *  The object_info cache lives inside the returned instance (mirroring the
 *  original per-request closure in workflow-detail.ts): each build starts
 *  with a cold `_comboObjectInfo` so a long-lived process never pins a stale
 *  object_info snapshot across requests.
 */
export function createComboResolver(): {
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
} {
  let _comboObjectInfo: Awaited<ReturnType<typeof fetchObjectInfo>> | undefined;
  const ensureObjectInfo = async () => {
    if (_comboObjectInfo === undefined) _comboObjectInfo = await fetchObjectInfo();
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
  const comboOptionsForClassField = async (
    classType: string | undefined,
    field: string
  ): Promise<string[] | undefined> => {
    const [specOpts, localOpts] = await Promise.all([
      (async () => {
        if (!classType) return undefined;
        const oi = await ensureObjectInfo();
        if (!oi) return undefined;
        const def = oi[classType];
        if (!def?.input) return undefined;
        const spec =
          def.input.required?.[field] ??
          def.input.optional?.[field];
        return comboOptionsFromSpec(spec);
      })(),
      localModelFileNames(modelFoldersForField(field)),
    ]);

    const merged = new Set<string>();
    if (specOpts) for (const o of specOpts) merged.add(o);
    for (const o of localOpts) merged.add(o);
    const out = Array.from(merged);
    return out.length ? out.sort((left, right) => left.localeCompare(right)) : undefined;
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
    field: string
  ): Promise<string[] | undefined> => {
    const oi = await ensureObjectInfo();
    if (!oi) return undefined;
    const merged = new Set<string>();
    let found = false;
    for (const def of Object.values(oi)) {
      const inp = def.input;
      if (!inp) continue;
      const spec =
        inp.required?.[field] ??
        inp.optional?.[field];
      const opts = comboOptionsFromSpec(spec);
      if (opts) {
        found = true;
        for (const o of opts) merged.add(o);
      }
    }
    if (!found) return undefined;
    for (const o of await localModelFileNames(modelFoldersForField(field))) merged.add(o);
    const out = Array.from(merged);
    return out.length ? out.sort((left, right) => left.localeCompare(right)) : undefined;
  };

  return { comboOptionsForClassField, comboOptionsForFieldName };
}
