#!/usr/bin/env python3
"""One-shot CSS replacement for SubagentDetail.vue part-rail block."""
import sys

PATH = r'F:\Projects\opencode-monitor\src\components\SubagentDetail.vue'

OLD = r'''/* Left rail — Zed agent chat has a thin icon column. We use a 2px color
   marker so it can read whole-stream rhythms without competing with the
   icon-heavy part bodies (read/write/edit/wrench). */
.part-rail {
  width: 2px;
  height: 14px;
  margin-top: 6px;
  justify-self: end;
  background: transparent;
  border-radius: 1px;
  opacity: 0.55;
  transition: opacity var(--duration-fast) var(--ease-out-quint);
}

.part:hover .part-rail { opacity: 1; }

.part[data-type='text']      .part-rail { background: var(--info); }
.part[data-type='tool']      .part-rail { background: var(--success); }
.part[data-type='reasoning'] .part-rail { background: rgba(141, 147, 158, 0.7); }
.part[data-type='subtask']   .part-rail { background: var(--text-accent); }
'''

NEW = r'''/* Left rail — Zed agent chat has a thin icon column. We render a 2px
   color marker so it can read whole-stream rhythms without competing
   with the icon-heavy part bodies (read/write/edit/wrench).

   Each part type's first-line element has a different vertical center,
   so we apply per-type margin-top offsets that nail the rail's center
   to that exact first-line center. Math (px from .part grid top):

     text      cap-mid  ≈ 11.5px (14px font / 1.55 lh, IBM Plex Sans)
     reasoning icon-mid  ≈ 13px  (.thinking 2px margin + 11px in 22px row)
     tool      icon-mid  ≈ 19px  (.tool-card 4px + header pad 4px + 11px in 22px row)
     subtask   icon-mid  ≈ 18px  (.subagent-card 4px + 14px in 28px row)

   With height: 14px the visible strip spans (margin-top, margin-top+14).
   Center within the strip is `margin-top + 7`. Setting that equal to
   each first-line center gives the per-type margin-top values below. */
.part-rail {
  width: 2px;
  height: 14px;
  margin-top: 0;            /* default — overridden per data-type below */
  justify-self: end;
  align-self: start;        /* explicit so the grid cell never stretches */
  background: transparent;
  border-radius: 1px;
  opacity: 0.55;
  transition: opacity var(--duration-fast) var(--ease-out-quint);
}

.part:hover .part-rail { opacity: 1; }

/* Per-type vertical alignment — nails each rail's center to the
   first-line visual center of its part body. A subtle box-shadow gives
   the strip a touch of luminous depth so it reads as a UI marker,
   not a stray bullet. */
.part[data-type='text']      .part-rail {
  margin-top: 5px;          /* center y=12 — text cap-mid */
  background: var(--info);
  box-shadow: 0 0 4px rgba(89, 194, 255, 0.30);
}
.part[data-type='reasoning'] .part-rail {
  margin-top: 6px;          /* center y=13 — thinking icon-mid */
  background: rgba(141, 147, 158, 0.9);
  box-shadow: 0 0 4px rgba(141, 147, 158, 0.20);
}
.part[data-type='tool']      .part-rail {
  margin-top: 12px;         /* center y=19 — tool card icon-mid */
  background: var(--success);
  box-shadow: 0 0 4px rgba(112, 191, 86, 0.30);
}
.part[data-type='subtask']   .part-rail {
  margin-top: 11px;         /* center y=18 — subagent card icon-mid */
  background: var(--text-accent);
  box-shadow: 0 0 4px rgba(230, 180, 80, 0.30);
}
'''

with open(PATH, 'r', encoding='utf-8', newline='') as f:
    src = f.read()

if OLD not in src:
    print('ERROR: old block not found verbatim', file=sys.stderr)
    sys.exit(2)

count = src.count(OLD)
if count != 1:
    print(f'ERROR: old block matched {count} times, expected 1', file=sys.stderr)
    sys.exit(3)

new_src = src.replace(OLD, NEW)

with open(PATH, 'w', encoding='utf-8', newline='') as f:
    f.write(new_src)

print(f'OK: replaced {count} occurrence. New file size: {len(new_src)} bytes')
