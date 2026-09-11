import { FILLS, DIVISIONS, BEHAVIOUR_RULES } from './kit.generated';

/* =============================================================
   The Roles screen's data, in the shape the kit's markup takes.

   `docs/source/roles_hub/HANDOFF.md`:

     Replace the static markup inside repeating regions with a loop over
     roles-data.json. Keep every wrapper element, every class and the
     nesting order. Bind the real role data.

   This file is the loop's input. It reads the four tables the real
   permission model lives in (role_templates, capability_catalog,
   role_template_capabilities, role_holders) and turns them into
   exactly what each repeating region of `roles-page.html` binds: a
   node per role in the chart, a row per role in the rail, a panel per
   role in the inspector, and the numbers in the header and footers.

   Nothing in here is a style. Class names appear because the kit
   chooses a class by data (which division tints a node, which class
   draws a 59% bar) and that choice is data too. The names come from
   `kit.generated.ts`, which a script read out of the kit's own CSS.

   ---- Verdicts ----

   The kit draws four verdicts in a panel: Allowed, Conditional,
   Inherited and Denied. The database has a grant with a scope, or no
   grant. So a company wide grant is Allowed, a grant narrowed to the
   person's own records or department is Conditional, and no grant is
   Denied. Inherited is never drawn, because nothing here inherits: a
   role holds a capability or it does not.
   ============================================================= */

export type Template = {
  id: string; slug: string; name: string; description: string | null;
  department: string | null; manages: string[]; escalates_to: string | null;
  sort_order: number; customised_at: string | null;
};

export type Cap = {
  key: string; label: string; description: string;
  area: string; feature: string; danger: string; position: number;
};

export type Grant = { role_template_id: string; capability: string; scope: string };
export type Holder = { id: string; role_template_id: string; name: string; job_title: string | null };

/** One row of `role_capability_history`, which migration 108 defines. */
export type Line = {
  id: number; at: string; actor_label: string | null; kind: string;
  role_template_id: string; capability_label: string;
  scope_before: string | null; scope_after: string | null;
};

export type Input = {
  roles: Template[]; caps: Cap[]; grants: Grant[]; holders: Holder[];
  history?: Line[];
};

/* ---- Departments onto the kit's five divisions ----

   The kit tints five divisions and this application has five
   departments. Matched by what each one is: Leadership is the group,
   Sales and Marketing sit on the two customer facing tints, Finance and
   Office take the remaining two. The labels are ours; the tints, and
   the classes that carry them, are the kit's. */
export type Division = keyof typeof DIVISIONS;

export const DEPARTMENTS: { key: string; label: string; division: Division }[] = [
  { key: 'exec',      label: 'Leadership', division: 'grp' },
  { key: 'sales',     label: 'Sales',      division: 'sales' },
  { key: 'marketing', label: 'Marketing',  division: 'hire' },
  { key: 'finance',   label: 'Finance',    division: 'stc' },
  { key: 'admin',     label: 'Office',     division: 'sys' },
];

const departmentOf = (d: string | null) =>
  DEPARTMENTS.find((x) => x.key === d) ?? DEPARTMENTS[DEPARTMENTS.length - 1]!;

/* The kit's own words for the scopes the database carries. */
const SCOPE: Record<string, string> = {
  own: 'Their own records',
  assigned: 'Assigned to them',
  team: 'Their team',
  department: 'Their department',
  project: 'Their projects',
  company: 'Company wide',
};

export const initials = (name: string) => name.split(/\s+/).filter(Boolean)
  .slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/* -------------------------------------------------------------
   Coverage bars.

   The kit has one class per bar it drew, each fixing a width and a
   tone: green up to 46%, amber from 50% to 80%, red from 82%. A real
   percentage that the kit happens to have a class for uses that class
   and nothing else. One it does not (47%, say) takes the nearest class
   of the right tone, so the tone is still the kit's, and carries its
   own width inline, because a width is the datum and there is no class
   for it. The bands themselves are read off the classes, not chosen.
   ------------------------------------------------------------- */
export type Fill = { cls: string; width: string | null };

const maxSuccess = Math.max(...FILLS.filter((f) => f.tone === 'success').map((f) => f.pct));
const minDanger = Math.min(...FILLS.filter((f) => f.tone === 'danger').map((f) => f.pct));

export function fillFor(pct: number): Fill {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const exact = FILLS.find((f) => f.pct === p);
  if (exact) return { cls: exact.cls, width: null };
  const tone = p <= maxSuccess ? 'success' : p >= minDanger ? 'danger' : 'warning';
  const nearest = FILLS.filter((f) => f.tone === tone)
    .sort((a, b) => Math.abs(a.pct - p) - Math.abs(b.pct - p))[0]!;
  return { cls: nearest.cls, width: `${p}%` };
}

/* -------------------------------------------------------------
   The view model.
   ------------------------------------------------------------- */
export type Verdict = 'allowed' | 'conditional' | 'denied';

export type NodeView = {
  id: string; name: string; division: string; tintCls: string;
  /** The kit's four node boxes: the root, a director, a role, one outside the line. */
  boxCls: 'r-6u' | 'r-4s' | 'r-29' | 'r-33';
  holders: number; capsText: string; elevated: boolean;
};

export type ColumnItem =
  | { kind: 'node'; node: NodeView }
  | { kind: 'rule' }
  | { kind: 'branches'; branches: Column[] };
export type Column = ColumnItem[];

export type Chart = {
  root: NodeView | null;
  branches: Column[];
  direct: NodeView[];
  footer: string;
};

export type Panel = {
  id: string; name: string; division: string; headCls: string;
  allowed: number; conditional: number; blocked: number; total: number; pct: number; fill: Fill;
  avatars: string[]; plus: number | null; peopleText: string;
  keys: { label: string; scope: string; verdict: Verdict }[];
  coverage: { area: string; pct: number; fill: Fill }[];
  base: { title: string; text: string };
  line: { title: string; text: string };
  scope: { title: string; text: string };
  flag: { title: string; text: string } | null;
  people: PersonRow[];
  history: HistoryRow[];
};

/* ---- The People tab ----

   The kit's row is an avatar, a name, a second line and a date. The
   second line is the person's job title. The date is when they went
   onto this role, and NOTHING RECORDS THAT: `role_holders` is a view
   over `profiles`, whose `created_at` is when the account was made,
   which is a different fact and would be a wrong one to print. So the
   date shows the placeholder glyph until a role assignment writes a
   date somewhere, and that is named in the recap rather than filled
   with the nearest number to hand. */
export type PersonRow = { id: string; initials: string; name: string; title: string; since: string | null };

/* ---- The History tab ----

   The kit colours the dot by what the change was. Its three dots are
   success, info and danger, which are grant, rescope and revoke, and
   those are exactly the three kinds migration 108's view derives. */
export type HistoryRow = { id: number; dotCls: string; text: string; strong: string; tail: string; who: string };

export type RailRow = { id: string; name: string; holders: number; people: string[] };
export type RailGroup = { key: string; label: string; swatchCls: string; rows: RailRow[] };

export type ScreenModel = {
  ids: string[];
  defaultId: string;
  stats: { roles: number; capabilities: number; flags: number };
  legend: { label: string; swatchCls: string }[];
  chips: { key: string; label: string }[];
  chart: Chart;
  rail: RailGroup[];
  flags: { title: string; text: string };
  panels: Panel[];
  behaviourCss: string;
};

const DANGER_RANK: Record<string, number> = { destructive: 0, sensitive: 1, routine: 2 };

/* The kit's three dots, by what the change was. */
const DOT: Record<string, string> = { granted: 'r-8f', rescoped: 'r-8g', revoked: 'r-8h' };

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
};

export function buildModel(input: Input): ScreenModel {
  const roles = [...input.roles].sort((a, b) => a.sort_order - b.sort_order);
  const bySlug = new Map(roles.map((r) => [r.slug, r]));
  const grantsOf = new Map<string, Map<string, string>>();
  for (const g of input.grants) {
    if (!grantsOf.has(g.role_template_id)) grantsOf.set(g.role_template_id, new Map());
    grantsOf.get(g.role_template_id)!.set(g.capability, g.scope);
  }
  const holdersOf = new Map<string, Holder[]>();
  for (const h of input.holders) {
    if (!holdersOf.has(h.role_template_id)) holdersOf.set(h.role_template_id, []);
    holdersOf.get(h.role_template_id)!.push(h);
  }
  const total = input.caps.length;

  const verdictOf = (r: Template, key: string): { verdict: Verdict; scope: string | null } => {
    const scope = grantsOf.get(r.id)?.get(key);
    if (scope == null) return { verdict: 'denied', scope: null };
    return { verdict: scope === 'company' ? 'allowed' : 'conditional', scope };
  };
  const counts = (r: Template) => {
    let allowed = 0, conditional = 0;
    for (const scope of grantsOf.get(r.id)?.values() ?? []) {
      if (scope === 'company') allowed += 1; else conditional += 1;
    }
    return { allowed, conditional, blocked: Math.max(0, total - allowed - conditional) };
  };
  const flagsOf = (r: Template) => ({
    nobody: (holdersOf.get(r.id)?.length ?? 0) === 0,
    changed: r.customised_at != null,
  });

  /* ---- The tree ---- */
  const children = (r: Template) => roles.filter((x) => x.escalates_to === r.slug);
  const descendants = (r: Template): number =>
    children(r).reduce((n, c) => n + 1 + descendants(c), 0);
  const roots = roles.filter((r) => !r.escalates_to || !bySlug.has(r.escalates_to));
  /* The chart's root is the top of the longest reporting line. Any
     other role with nothing above it is outside that line, and the kit
     draws those apart, under "Directly assigned". */
  const chartRoot = [...roots].sort((a, b) => descendants(b) - descendants(a) || a.sort_order - b.sort_order)[0] ?? null;
  const direct = roots.filter((r) => r !== chartRoot);

  const nodeOf = (r: Template, box: NodeView['boxCls']): NodeView => {
    const dept = departmentOf(r.department);
    const c = counts(r);
    return {
      id: r.slug, name: r.name, division: dept.label.toUpperCase(),
      tintCls: DIVISIONS[dept.division].node, boxCls: box,
      holders: holdersOf.get(r.id)?.length ?? 0,
      capsText: `${c.allowed + c.conditional} of ${total}`,
      elevated: (grantsOf.get(r.id)?.has('admin.roles')) ?? false,
    };
  };
  const boxFor = (r: Template): NodeView['boxCls'] =>
    (r === chartRoot ? 'r-6u' : r.department === 'exec' ? 'r-4s' : 'r-29');

  /* A column is a role and what hangs beneath it. One report continues
     the column with a short rule between, as the kit chains Depot
     Manager under Operations Director; two or more reports branch
     sideways, as the kit fans Commercial Director's three. */
  const column = (r: Template): Column => {
    const items: Column = [{ kind: 'node', node: nodeOf(r, boxFor(r)) }];
    const kids = children(r);
    if (kids.length === 1) items.push({ kind: 'rule' }, ...column(kids[0]!));
    else if (kids.length >= 2) items.push({ kind: 'branches', branches: kids.map(column) });
    return items;
  };
  const rootKids = chartRoot ? children(chartRoot) : [];
  const branches = rootKids.length >= 2 ? rootKids.map(column)
    : rootKids.length === 1 ? [column(rootKids[0]!)] : [];

  const departmentsPresent = DEPARTMENTS.filter((d) => roles.some((r) => departmentOf(r.department) === d));
  const chart: Chart = {
    root: chartRoot ? nodeOf(chartRoot, 'r-6u') : null,
    branches,
    direct: direct.map((r) => nodeOf(r, 'r-33')),
    footer: `${roles.length} roles across ${departmentsPresent.length} divisions · ${roles.length} shown, 0 collapsed`,
  };

  /* ---- The rail ---- */
  const rail: RailGroup[] = departmentsPresent.map((d) => ({
    key: d.key, label: d.label.toUpperCase(), swatchCls: DIVISIONS[d.division].swatch,
    rows: roles.filter((r) => departmentOf(r.department) === d).map((r) => ({
      id: r.slug, name: r.name,
      holders: holdersOf.get(r.id)?.length ?? 0,
      people: (holdersOf.get(r.id) ?? []).map((h) => h.name),
    })),
  }));

  /* ---- The panels ---- */
  const keyCaps = [...input.caps]
    .filter((c) => c.danger === 'destructive' || c.danger === 'sensitive')
    .sort((a, b) => (DANGER_RANK[a.danger] ?? 9) - (DANGER_RANK[b.danger] ?? 9) || a.position - b.position)
    .slice(0, 5);
  const areas = [...new Set(input.caps.map((c) => c.area))];

  const panels: Panel[] = roles.map((r) => {
    const dept = departmentOf(r.department);
    const c = counts(r);
    const granted = c.allowed + c.conditional;
    const pct = total === 0 ? 0 : Math.round((granted / total) * 100);
    const people = holdersOf.get(r.id) ?? [];
    const shown = people.slice(0, 4);
    const parent = r.escalates_to ? bySlug.get(r.escalates_to) : undefined;
    const f = flagsOf(r);
    const lines = (input.history ?? []).filter((h) => h.role_template_id === r.id);
    return {
      id: r.slug, name: r.name, division: dept.label.toUpperCase(),
      headCls: DIVISIONS[dept.division].head,
      ...c, total, pct, fill: fillFor(pct),
      avatars: shown.map((h) => initials(h.name)),
      plus: people.length > shown.length ? people.length - shown.length : null,
      peopleText: `${people.length} ${people.length === 1 ? 'person' : 'people'}`,
      keys: keyCaps.map((k) => {
        const v = verdictOf(r, k.key);
        return {
          label: k.label,
          scope: v.verdict === 'denied' ? k.area : (SCOPE[v.scope!] ?? v.scope!),
          verdict: v.verdict,
        };
      }),
      coverage: areas.map((area) => {
        const inArea = input.caps.filter((x) => x.area === area);
        const held = inArea.filter((x) => grantsOf.get(r.id)?.has(x.key)).length;
        const p = inArea.length === 0 ? 0 : Math.round((held / inArea.length) * 100);
        return { area, pct: p, fill: fillFor(p) };
      }),
      base: {
        title: `Base role: ${r.name}`,
        text: `${granted} ${granted === 1 ? 'capability' : 'capabilities'} granted directly.`,
      },
      line: {
        title: 'Reporting line',
        text: parent
          ? `What it is refused goes to ${parent.name} to decide.`
          : 'Top of the reporting line. Nothing escalates above it.',
      },
      scope: {
        title: 'Scope applied',
        text: c.conditional > 0
          ? `${c.conditional} ${c.conditional === 1 ? 'capability is' : 'capabilities are'} narrowed to the person's own records or department.`
          : 'Every capability applies company wide.',
      },
      people: people.map((h) => ({
        id: h.id, initials: initials(h.name), name: h.name,
        title: h.job_title ?? dept.label, since: null,
      })),
      history: lines.map((h) => ({
        id: h.id,
        dotCls: DOT[h.kind] ?? DOT.rescoped!,
        text: h.kind === 'granted' ? 'Granted ' : h.kind === 'revoked' ? 'Revoked ' : 'Narrowed ',
        strong: h.capability_label,
        tail: h.kind === 'rescoped' && h.scope_after ? ` to ${SCOPE[h.scope_after] ?? h.scope_after}` : '',
        who: `${h.actor_label ?? 'Somebody'} · ${when(h.at)}`,
      })),
      flag: f.nobody
        ? { title: 'Nobody on this role', text: 'No active person holds it, so nothing it grants is in use. Put somebody on it or retire it.' }
        : f.changed
          ? { title: 'Changed from its template', text: 'Its capabilities no longer match the seeded role, so a fresh seed leaves it alone. Review what was changed.' }
          : null,
    };
  });

  /* ---- Flags ---- */
  const nobody = roles.filter((r) => flagsOf(r).nobody).length;
  const changed = roles.filter((r) => flagsOf(r).changed).length;
  const flagCount = nobody + changed;
  const parts: string[] = [];
  if (nobody > 0) parts.push(`${nobody} with nobody on ${nobody === 1 ? 'it' : 'them'}`);
  if (changed > 0) parts.push(`${changed} changed from ${changed === 1 ? 'its' : 'their'} template`);
  const flagText = parts.length === 0
    ? 'Every role has somebody on it and matches its template.'
    : parts.join(', ').replace(/^./, (s) => s.toUpperCase()) + '.';

  const ids = roles.map((r) => r.slug);
  return {
    ids,
    defaultId: chartRoot?.slug ?? ids[0] ?? '',
    stats: { roles: roles.length, capabilities: total, flags: flagCount },
    legend: departmentsPresent.map((d) => ({ label: d.label, swatchCls: DIVISIONS[d.division].swatch })),
    /* The kit's rail chips name its three operating divisions and leave
       Group and System off, and three is what its 250px rail fits. The
       same rule on the same tints: the departments that are neither. */
    chips: departmentsPresent.filter((d) => d.division !== 'grp' && d.division !== 'sys')
      .map((d) => ({ key: d.key, label: d.label })),
    chart,
    rail,
    flags: { title: `${flagCount} ${flagCount === 1 ? 'flag' : 'flags'} to review`, text: flagText },
    panels,
    behaviourCss: behaviourFor(ids),
  };
}

/** The kit's three selection rules, written for these ids. */
export function behaviourFor(ids: readonly string[]): string {
  return ids.flatMap((id) => BEHAVIOUR_RULES.map((r) => r.split('{id}').join(id))).join('\n');
}
