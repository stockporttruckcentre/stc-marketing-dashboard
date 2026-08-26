/* =============================================================
   Reading a saved view off the wire.

   Shared by both view routes rather than exported from one of them.
   Next.js treats every export from a route file as a route field, so a
   helper living there fails the build with "readView is not a valid
   Route export field" and nothing about the message says why.

   What it enforces is the shape, not the permission. Who may save a
   view is `views_insert` and `views_update` in migration 056, and this
   file never second guesses them.
   ============================================================= */

const LAYOUTS = ['board', 'table', 'list', 'calendar', 'timeline', 'workload'];
const GROUPS = ['status', 'assignee', 'priority', 'project', 'department', 'due', 'none'];

/** A filter is only as safe as it is shaped. Anything else is refused. */
function validFilter(node: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.all)) return n.all.every((c) => validFilter(c, depth + 1));
  if (Array.isArray(n.any)) return n.any.every((c) => validFilter(c, depth + 1));
  if (n.not) return validFilter(n.not, depth + 1);
  return typeof n.field === 'string' && typeof n.op === 'string';
}

export function readView(
  b: Record<string, unknown>,
): { row: Record<string, unknown> } | { error: string } {
  const name = String(b.name ?? '').trim();
  if (!name) return { error: 'Give the view a name.' };
  if (name.length > 80) return { error: 'That name is too long for the rail.' };

  const layout = LAYOUTS.includes(String(b.layout)) ? String(b.layout) : 'list';
  const group_by = GROUPS.includes(String(b.group_by)) ? String(b.group_by) : 'status';

  const filter = b.filter ?? { all: [] };
  if (!validFilter(filter)) return { error: 'That filter is not a shape this understands.' };

  const sort = Array.isArray(b.sort)
    ? (b.sort as { field?: unknown; dir?: unknown }[])
        .filter((s) => typeof s.field === 'string')
        .map((s) => ({ field: String(s.field), dir: s.dir === 'desc' ? 'desc' : 'asc' }))
    : [];

  const fields = Array.isArray(b.fields) ? b.fields.map(String).slice(0, 24) : [];

  return {
    row: {
      name,
      description: b.description ? String(b.description).trim() || null : null,
      layout,
      group_by,
      sub_group_by: b.sub_group_by ? String(b.sub_group_by) : null,
      sort,
      filter,
      fields,
      options: (b.options && typeof b.options === 'object') ? b.options : {},
    },
  };
}
