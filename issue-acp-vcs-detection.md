# ACP mode: VCS detection fails — snapshot tracking and revert not working

## Summary

When opencode is launched in **ACP mode** (e.g. via Zed extension), VCS detection fails for git repositories. This causes the snapshot tracking system to be silently disabled: all `step-finish` parts have empty `snapshot` fields, no `patch` parts are ever created, and the revert API (`POST /session/:id/revert`) returns 200 OK but does not revert any file changes.

## Environment

- **opencode version**: 1.17.9
- **OS**: Windows 11
- **Launch mode**: ACP (`opencode.exe acp`)
- **Editor**: Zed Editor (built-in ACP integration)
- **Project**: A git repository with `.git/`, valid `HEAD`, and existing commits

## Symptoms

### 1. VCS detection fails

The system prompt injected into the LLM shows:

```
Is directory a git repo: no
```

…even though the project **is** a valid git repository:

```
$ git rev-parse --is-inside-work-tree
true
$ git rev-parse HEAD
<valid commit hash>
```

### 2. Snapshot tracking never activates

Across a session with **189 steps** (189 `step-finish` parts), **zero** have a `snapshot` field populated:

| Metric | Count |
|---|---|
| `step-start` parts | 189 |
| `step-finish` parts | 189 |
| `step-finish` parts **with** `snapshot` | **0** |
| `patch` parts | **0** |
| `tool` parts | 259 |

### 3. Revert API returns 200 but does nothing

```
POST /session/:id/revert → 200 OK
```

Response includes `summary: { additions: 0, deletions: 0, files: 0 }` — no file changes were recorded, so revert has nothing to undo. The API "succeeds" silently.

### 4. `/undo` command not available

In ACP mode (Zed), typing `/` does not surface an `undo` command. This is consistent with the snapshot system being disabled — there are no patches to undo.

## Comparison: CLI mode works correctly

Running opencode in **CLI/TUI mode** (`opencode` without `acp` arg) on the **same project** works perfectly:

- System prompt shows `Is directory a git repo: yes`
- All `step-finish` parts have `snapshot` populated (80/80 in test session)
- `/undo` successfully reverts file changes (including deleting newly-created files)

## Shadow git repo is healthy

The shadow git repository (`~/.local/share/opencode/snapshot/<project-id>/<hash>/`) **does exist** and functions correctly when exercised manually:

```
$ opencode debug snapshot track
2556672a13073c51e1e93659505ace20454fb7fd

$ git --git-dir=<shadow-dir> --work-tree=<project> write-tree
2556672a13073c51e1e93659505ace20454fb7fd

$ git --git-dir=<shadow-dir> --work-tree=<project> ls-files | wc -l
64
```

The shadow repo config confirms the correct worktree:
```
[core]
    worktree = F:/Projects/<project>
```

This suggests the failure is in the **VCS detection step** that feeds `project.vcs`, not in the snapshot/git machinery itself.

## Likely root cause

In the processor's `step-finish` handler (`packages/opencode/src/session/processor.ts`), snapshot tracking is conditional on `project.vcs === "git"`. If ACP mode's project initialization fails to detect git (setting `project.vcs` to `undefined` or a non-`"git"` value), `snapshot.track()` is never called, no `snapshot` field is stored on `step-finish` parts, and no `patch` parts are created.

The `Snapshot.summarize` function also has an early return: `if ((yield* i.get()).snapshot === false) return;` — if the snapshot config is explicitly disabled or defaults to falsy in ACP mode, this would explain the behavior.

No errors are logged — the `Effect` framework's `.nothrow()` pattern (referenced in closed issue #10589) silently swallows any VCS detection failures.

## Impact

- **All ACP-mode users** (Zed Editor, VS Code, any ACP-compatible editor) cannot revert messages
- File changes made by the AI agent are permanent — no undo capability
- The API misleadingly returns 200 OK, making it appear the revert succeeded
- `/undo` is not available in ACP mode

## Reproduction

1. Open a git repository in Zed Editor with opencode ACP integration
2. Send a message that creates/modifies files
3. Observe that the system prompt says `Is directory a git repo: no`
4. Try to revert the message (via API or `/undo`) — no file changes are reverted
5. Repeat the same in CLI mode (`opencode` in terminal) — VCS detected, revert works

## Expected behavior

ACP mode should detect git repositories the same way CLI mode does, enabling snapshot tracking and revert functionality.
