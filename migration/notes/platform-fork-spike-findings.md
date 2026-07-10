# Spike: "Action item list" in the New Issue create dialog

**Date:** 2026-07-08
**Goal:** Determine if we can add the `/` → **Action item list** option to the issue *create* dialog by forking `hcengineering/platform`, and what the per-upgrade cost is.
**Isolation:** All work in `/home/karthi_0008/dev/client-projects/yg-platform-spike/` (clone of `platform@v0.7.426`). The running `huly-migration/huly-selfhost` stack was NOT touched.

## 1. Root cause (confirmed in source)

Action items (`todoItem`/`todoList`) are gated on editor **mode** in
`plugins/text-editor-resources/src/kits/editor-kit.ts`:

```ts
todoItem: e(TodoItemExtension, context.mode === 'full' && { context: getActionContext(context) }),
todoList: e(TodoListExtension, context.mode === 'full')
```

`EditorKitContext.mode?: 'full' | 'compact'`. The create dialog
(`plugins/tracker-resources/src/components/CreateIssue.svelte:878`) passes
`kitOptions={{ reference: true }}` — no mode → not 'full' → action items + drawing board + math/embeds are all off. The full (post-creation) editor runs in 'full' mode, which is why they appear only after the issue exists.

## 2. The change (one line, applied in the spike copy)

`CreateIssue.svelte:878`
```diff
- kitOptions={{ reference: true }}
+ kitOptions={{ reference: true, mode: 'full' }}
```

The create dialog already passes `objectId`, `_class`, and `space` (needed by `getActionContext` for full mode), so no other change is required. This also enables math/embeds/drawing-board in the create dialog.

⚠️ Not yet verified in a browser (requires building the image — see §4). Behavioural risk to confirm on a real build: action items can carry assignees + land in a Planner; Huly gated them post-creation, so pre-save behaviour must be tested.

## 3. Build pipeline (mapped)

The `front` image is NOT a self-contained docker build — it copies pre-built artifacts:

- `pods/front/Dockerfile`: `FROM hardcoreeng/front-base:v20250916`, copies `bundle/` + `dist/`.
- `dist/` = the **web client**, copied from `dev/prod/dist` (`pods/front` `package` script).
- `dev/prod` depends on `@hcengineering/tracker-resources` → our edit compiles in here. **This is the heavy step.**

Full sequence:
```
node common/scripts/install-run-rush.js install   # 481 projects, many GB, ~10-20 min
# build dev/prod web client (heavy webpack/svelte compile of ALL plugins) — several GB RAM
rushx bundle        (in pods/front)   # esbuild the front server
rushx package       (in pods/front)   # copy dev/prod/dist -> pods/front/dist
docker build ...    (pods/front/Dockerfile) -> your image
```

## 4. Feasibility verdict

| Aspect | Verdict |
|---|---|
| Code change | ✅ Trivial, isolated, low upgrade-conflict risk (one distinctive line) |
| Build on THIS host | ❌ Unsafe — web build needs ~4-8 GB RAM; host has ~3.6 GB free while running the stack (redpanda already OOM-crashed once). Would likely crash the live stack. |
| Build in CI / bigger box | ✅ Recommended — `.github/workflows/main.yml` already builds images; a fork CI job builds + pushes with zero local risk |

## 5. Per-upgrade cost (the "fork tax")

Each new Huly version:
1. Rebase the 1-line patch (low conflict risk, but not zero — editor code changes often).
2. Rebuild the front image (rush install + dev/prod compile) — **mandatory**, ~30-60 min in CI.
3. Retest action-item behaviour in the create dialog.

## 6. Recommendation

- The change is real and small, but it commits you to **building & shipping a custom `front` image on every upgrade**.
- **Do the build in CI on the `yg-platform` fork** (or a ≥16 GB machine), push to `ghcr.io/youngglobes/front:<ver>-yg`, and point `yg-huly/compose.yml` at it. Never build on the production host.
- Reconsider vs. the zero-maintenance workaround (create issue with title first, then `/` → Action item list).
