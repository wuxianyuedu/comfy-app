/**
 * turbopackIgnore: the only home for "do not trace this computed path".
 * ===========================================================================
 *
 * Why this module exists
 * ----------------------
 * `next build` (Turbopack) statically analyses every filesystem call. When it
 * cannot statically scope the path argument -- the path depends on `cwd()`, on
 * `process.env`, on a directory entry, on an HTTP parameter -- it gives up and
 * emits `Dynamic filesystem access causes tracing of the whole project` for
 * that call site (and deliberately keeps tracing, see below).
 *
 * The escape hatch is an ignore comment, and its *placement* is the catch:
 * Turbopack looks at the **expression that computes the path**, not at the fs
 * call that consumes it. An annotation buried in the call arguments -- which is
 * how every call site in this repo used to write it -- is silently ignored.
 *
 * TODO(ISSUE #489): placement was corrected here, but the annotation still has
 * no effect on `fs.*` (measured on Next 16.3.2: all four placements warn
 * identically). The annotation is kept on the correct expression so it starts
 * working the moment Turbopack honours it, and because misplacing it is what
 * made the previous "already fixed" claims wrong. The defence that actually
 * holds the artefact size in place is `outputFileTracingExcludes` in
 * `next.config.js`, guarded by `tests/turbopack-tracing-excludes.test.ts`;
 * the reading rules are in `docs/standards/launch-and-build.md` sec.7.2.
 *
 * Usage -- spread the annotated tuple into the **path expression** (it works on
 * rest-parameter functions such as `path.join` / `path.resolve` / `fs.*`; do
 * NOT spread it into fixed-arity calls such as `spawn`):
 *
 *     path.resolve(process.cwd(), raw)                     <- annotation hidden, warns
 *     path.resolve(...tracingIgnoreArgs(), process.cwd(), raw) <- annotation on the expression
 *
 * Keep this file ASCII-only: it sits on the build-time module graph and Next's
 * error code frame renderer panics on multi-byte characters (see
 * `docs/standards/launch-and-build.md` sec.5).
 *
 * @module lib/tracing-ignore
 */

/**
 * Turbopack "do not trace this path" annotation, as a spreadable empty tuple.
 *
 * A tuple (rather than a bare number or a JSX-bearing value) is required: the
 * annotation has to sit in a value position, and spreading it must typecheck
 * against the rest parameter of `path.join` / `path.resolve` / `fs.*`.
 *
 * @returns an empty tuple whose source text carries the ignore comment. Each
 *   call site gets its own instance so the annotation is present literally at
 *   every dynamic path expression (Turbopack scans source, not runtime values).
 */
export function tracingIgnoreArgs(): [] {
  return (
    /* turbopackIgnore: true */
    []
  );
}
