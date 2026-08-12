# Dashboard upgrade plan

Build plan for `/dashboard` (first item in the sidebar). Written against the
codebase as it stands, not against the meeting notes alone. Where the spec and
the code disagree, the code is described here and the gap is called out.

Canonical source for the build session. The meeting spec is the requirement;
this file is the translation.

---

## Read this first: five things the spec assumes that are not true yet

The meeting notes describe a system slightly different from the one that exists.
None of these are reasons to change the requirement. They are work that has to
happen before or inside the build, and they change the order.

### 1. The role column cannot tell a rep from an exec

The spec splits rendering three ways: sales rep (Dave, Dean, Tom), exec
(Gareth, MD, FD), and marketer/support. Today `profiles.role` has four values:
`admin`, `marketer`, `sales`, `viewer`.

**Dave, Dean, Tom and Gareth are all `admin`.** The seed script
(`supabase/setup-users.mjs`) creates Tom, Alex, Dave and Dean as admins, and
`AnalyticsView` already has to work around Gareth being an admin by excluding
him from the rep leaderboard by name.

So role-based rendering has nothing to key off. Options:

- **Recommended.** Add `profiles.dashboard_variant` (`rep` | `exec` | `support`),
  defaulting to `rep`, set in the Team admin screen. This matches the spec's
  "if a user has no assigned role, show the sales rep view" exactly, and keeps
  permissions (`role`) separate from presentation (`variant`). Two concepts that
  are genuinely different should not share one column.
- Alternative: add `exec` to the `role` CHECK constraint. Cheaper, but conflates
  what someone may do with what they see, and every existing RLS policy that
  tests `current_role_safe() IN (...)` then has to be revisited.

Either way the Team screen (`components/AdminPanel.tsx`) needs a second dropdown.

### 2. Role-driven rendering is not a security boundary until a known bug is fixed

The exec view shows company-wide revenue, team pipeline by rep, and per-account
YoY movement. That is the most sensitive data in the product.

The RLS policy `profiles_update_self` (`supabase/schema.sql:193`) is
`FOR UPDATE USING (id = auth.uid())`. Postgres row-level security is row-level,
not column-level, so it lets any signed-in user write **any column of their own
profile row**, including `role`. Whatever column ends up driving the dashboard
variant will be writable by the user it is meant to constrain, unless the policy
is fixed at the same time.

**This is a hard prerequisite for the exec view, not a nice-to-have.** Fixing it
means dropping that policy and routing profile self-edits (display name, theme)
through a server route that never accepts `role` or `dashboard_variant`.

### 3. The exec view cannot use the app's normal data path

Every screen in this app reads Supabase directly from the browser and relies on
RLS to scope results. The exec view breaks that pattern, because RLS is
deliberately hiding exactly the data it needs.

Each rep's pipeline lives in `crm_contacts` rows belonging to a private
`crm_lists` row owned by that rep. The `crm_select` policy only returns rows
whose list is global, owned by the caller, or shared with the caller. Gareth
cannot see Dave's tracker, by design.

So company-wide aggregation has to happen **server-side**, in API routes, the way
`/api/stock/sold-info` and `/api/tracker/check-link` already do it with a direct
Postgres connection. That precedent is good and should be followed, including its
discipline: those routes return the minimum necessary and one of them carries an
explicit comment that commission is never included. Decide deliberately whether
Gareth sees commission. The existing code says no by default.

This makes the spec's "exec view is a separate render, not a subset" even more
true than intended. It is a different data path, not just different queries.

### 4. Six widgets count things that are not records

The spec refers throughout to `sales_tracker`, proposals, quotes, and
`last_activity_at`. None of these exist.

| Spec calls it | What is actually there |
|---|---|
| `sales_tracker` table | `crm_contacts` rows whose `list_id` points at a list named `%Sales tracker%` owned by that user, filtered by `side` |
| A proposal / quote record | `crm_contacts.status = 'quoted'` plus `estimated_value`. No proposal entity, no document, no separate lifecycle |
| `last_activity_at` | Does not exist. `updated_at` is touched by a trigger on any edit including a typo fix. `last_contact` is a nullable DATE set by hand and mostly empty |
| An account | Nothing formally. A company appears as a row in the global CRM list, and separately as a deal row in each rep's tracker |

**Recommendation for Tier 1:** treat a proposal as a tracker row at status
`contacted` or `quoted` with a non-null `estimated_value`. The tracker model is
already one row per deal (rows created from stock are literally named
`Lead - STC1234`), so the row *is* the deal. Do not build a proposals table for
Tier 1. Revisit when "Generate proposal" in widget 9 needs to produce an actual
document with its own lifecycle.

**`last_activity_at` needs to be real.** Widgets 2 and 4 are entirely built on
it, and Tom and Dave asked for them specifically, so getting it wrong makes the
flagship feature lie. Options in order of preference:

1. Add `crm_contacts.last_activity_at TIMESTAMPTZ`, written explicitly by the
   actions that count as activity: adding a note, logging a call, completing a
   scheduled action, changing status. Not by the generic `updated_at` trigger.
2. Derive it as `GREATEST(last note created_at, last completed action, last
   status change)` in a view. No new write paths, but slower and it needs a
   status-change log that does not exist.

Option 1 is recommended. It is a small column with an explicit contract, and it
is the difference between "no progress in 7 days" meaning something and meaning
"nobody opened the row".

### 5. Notifications were never built, so this is not a restore

The spec lists widget 7 as "restore this, it worked before, currently broken,
Tier 1 bug". In this repository there is no notifications table, no
notifications code, and no read/unread state anywhere. `components/TopBar.tsx:90`
has a bell button with a tooltip and no click handler:

```tsx
<button className="btn btn--icon" title="Notifications" aria-label="Notifications"><Bell size={14} /></button>
```

The only notification-shaped code is a local toast helper inside
`TeamCalendar.tsx` that fires for calendar events in the current session and
persists nothing.

Either it existed in a system this repo replaced, or the dead bell button read as
a broken feature. Practical effect: **budget widget 7 as a full build** (table,
RLS, write points, panel UI, read/unread, dismissal), not a bug fix. It is the
single most under-estimated item in the Tier 1 list.

---

## A warning about ownership, before adding another table

The spec asks for a new `account_ownership` table. That is the right shape, but
the app already has **four** different ways of associating a person with work,
and none of them agree:

| Mechanism | Type | Used by |
|---|---|---|
| `crm_lists.owner_id` | UUID, real FK | Sales tracker scoping, RLS |
| `crm_contacts.assigned_to` | free TEXT | CRM grid column |
| `crm_contacts.account_manager` | free TEXT | Tracker |
| `stock_trailers.sales_rep` | free TEXT, initials | Stock, analytics |

`AnalyticsView` already carries a hardcoded alias table (`david`, `dave`,
`david reay`, `dr`, `d.reay`) to reconcile these, which is why a new rep does not
appear on the leaderboard until someone edits the source.

Adding `account_ownership` as a fifth mechanism without a plan to retire the
free-text ones leaves the dashboard's "my portfolio" disagreeing with analytics'
leaderboard, and both disagreeing with the stock list. **Recommendation:** make
`account_ownership` authoritative, backfill it from `assigned_to` in a one-off
migration, and treat the text columns as deprecated display fields from then on.

---

## Schema work

All additive. In dependency order.

```sql
-- 1. Presentation variant, separate from permissions
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dashboard_variant TEXT
  NOT NULL DEFAULT 'rep' CHECK (dashboard_variant IN ('rep','exec','support'));

-- 2. Honest activity timestamp (widgets 2 and 4 depend on it)
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_last_activity
  ON crm_contacts (last_activity_at DESC NULLS LAST);

-- 3. The next-actions queue (widget 1). New concept, no precedent in the schema.
CREATE TABLE IF NOT EXISTS dashboard_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE,
  stock_trailer_id UUID REFERENCES stock_trailers ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('call','email','meeting','quote_followup','custom')),
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  priority SMALLINT NOT NULL DEFAULT 2,
  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_actions_queue
  ON dashboard_actions (user_id, due_at) WHERE completed_at IS NULL AND dismissed_at IS NULL;

-- 4. Portfolio ownership (widget 5). Authoritative; backfill from assigned_to.
CREATE TABLE IF NOT EXISTS account_ownership (
  contact_id UUID REFERENCES crm_contacts ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  role_on_account TEXT NOT NULL DEFAULT 'owner'
    CHECK (role_on_account IN ('owner','support','shadow')),
  assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (contact_id, user_id)
);

-- 5. Notifications (widget 7). Full build, not a restore.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lead_assigned','message','system_alert','sync_failure','yoy_anomaly')),
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL AND dismissed_at IS NULL;

-- 6. Targets (widget 8). Nothing like this exists today.
CREATE TABLE IF NOT EXISTS revenue_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,  -- NULL = company-wide
  period_month DATE NOT NULL,
  target_amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, period_month)
);

-- 7. Meeting delegation (widget 6). See the note below: policies change too.
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS owner_user_id UUID
  REFERENCES auth.users ON DELETE SET NULL;
UPDATE calendar_events SET owner_user_id = created_by WHERE owner_user_id IS NULL;
```

Every new table needs RLS policies written before it is used. The app has no
server-side permission layer to fall back on.

### Delegated meetings break more than the schema

Adding `owner_user_id` is the easy half. The existing calendar policies key
everything off `created_by`:

```sql
CREATE POLICY "calendar_update" ON calendar_events FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "calendar_delete" ON calendar_events FOR DELETE USING (auth.uid() = created_by);
```

In the spec's scenario Tom books a follow-up in Dave's diary. Tom is
`created_by`, Dave is `owner_user_id`. Under the current policies **Dave cannot
edit or cancel a meeting in his own diary.** The select policy has the same
problem: it returns events where `created_by = auth.uid()`, or visibility is
team, or the user is in `visible_to`. Dave sees it only if Tom remembers to add
him.

So widget 6 requires rewriting all four calendar policies to treat owner and
creator as equally privileged. That is a change to a shipped, working feature and
should be tested against the existing calendar screen, not just the dashboard.

---

## Widget build sheet

`Ready` means it can be built against data that exists today, once the schema
above lands. `Blocked` means it needs an external system that does not exist yet.

### Sales rep view

| # | Widget | Real data source | State |
|---|---|---|---|
| 1 | Next actions queue | New `dashboard_actions`, joined to `crm_contacts`. Seed rows from calendar events due today and tracker rows at `quoted` with no open action | Ready after schema |
| 2 | Inactive prospects | `crm_contacts` where list is the caller's tracker, status in (`contacted`,`quoted`), `last_activity_at < now() - interval '7 days'`, ordered by `estimated_value` desc | Ready after `last_activity_at` |
| 3 | Proposals in flight, split | Same rows, grouped. Prospective vs existing needs a rule: recommend existing = the company has any row at status `customer` or a linked sold `stock_trailers` row; otherwise prospective | Ready, needs the rule confirmed |
| 4 | Top 5 stuck by revenue | Widget 2's query, `LIMIT 5`. Build as one query with two consumers, not two queries | Ready after `last_activity_at` |
| 5 | My portfolio | New `account_ownership`. Metrics: account count, open proposals, revenue MTD/YTD from tracker rows at `customer` with `sale_price` | Ready after schema and backfill |
| 6 | Meetings today / this week | `calendar_events` now, Microsoft Graph `/me/events` later | Blocked on M365 SSO. Ship CRM-only first |
| 7 | Notifications | New `notifications` table plus write points | Full build, not a restore |
| 8 | Revenue vs target | `revenue_targets` plus tracker `sale_price`. Radar/gauge per Tom | Needs targets loaded. Protean only improves the actuals |
| 9 | Quick actions bar | Routes to existing screens. Add prospect and Generate proposal are Tier 1 | Ready. Natural-language search stays a placeholder |

### Exec view

Built from server-side aggregation routes, not browser queries. See prerequisite 3.

| # | Widget | Real data source | State |
|---|---|---|---|
| 1 | Company revenue vs target | Aggregate all tracker rows at `customer` plus `revenue_targets` where `user_id IS NULL` | Needs targets and an aggregation route |
| 2 | Team pipeline by rep | Aggregate open tracker rows across all lists, grouped by `crm_lists.owner_id` | Ready after aggregation route |
| 3 | YoY revenue alerts | Per account, this month vs baseline. See open decisions | Blocked on Protean for invoice-level truth. A tracker-only version is possible sooner |
| 4 | Weekly digest preview | Whatever generates the Friday email. Does not exist yet | Blocked on the digest job existing |
| 5 | Invoice volume trend | Invoice counts per account YoY. **No invoice data exists anywhere in the schema** | Fully blocked on Protean |

---

## Revised sequencing

The spec's tiering is sound. Two changes, both driven by findings above.

**Tier 0, before any widget.** Not in the original list, but Tier 1 depends on it.

1. Fix `profiles_update_self` so the variant column is not self-writable.
2. Add `dashboard_variant` and the Team screen control for it.
3. Add `last_activity_at` and write it from the note, status and action paths.
4. Confirm the live schema matches `supabase/schema.sql`. The file references
   `is_list_member_safe()`, which is defined nowhere in the repo, so the file
   and production have already diverged. Dump the real schema before writing
   migrations against this one.

**Tier 1, soft launch.** Widgets 1, 2, 3, 4, 5, 7, 9, plus role rendering with a
basic exec view. Note that widget 7 is a full build and widget 5 needs the
ownership backfill, so this tier is larger than the widget count suggests.

**Tier 2, weeks 3 to 8.** Widget 6 (CRM calendar first, Graph when SSO lands,
delegation policies rewritten), widget 8 (once targets are loaded by hand,
independent of Protean), and the full exec view.

**Tier 3.** Natural-language search. Custom colour themes.

### One sequencing point on custom themes

Custom per-user theming is listed as Tier 3, which is right, and it should stay
behind the design-system rebrand rather than in front of it. The app themes on
`data-theme` with a `stc_theme` cookie and a `profiles.theme` column constrained
to `dark` or `light`. The UI kit themes on `data-stc-theme` with its own token
set. Building custom themes on the current mechanism means building them twice.

---

## Open decisions, for Dave and Tom

These need a human answer. Each one changes what gets built, so none should be
guessed.

1. **YoY baseline.** Same calendar month last year, rolling 12, or fiscal year?
   Worth knowing that `AnalyticsView` already implements "the equally sized
   window immediately before this one", which is none of the three. Whatever is
   chosen, analytics should be changed to match, or the two screens will show
   different numbers for the same question.
2. **Prospective versus existing.** What makes a customer existing? Recommended
   rule is in the widget 3 row above, but this is a commercial definition, not a
   technical one.
3. **Inactivity threshold.** Spec says 7 days configurable to 14. Per user, per
   role, or one company-wide setting? Cheapest is company-wide in Tier 1.
4. **Does Gareth see commission?** The exec view aggregates rep revenue. The
   existing cross-RLS routes deliberately exclude commission. Confirm whether
   that stands for the exec dashboard.
5. **Does an exec also have a rep view?** If Gareth ever works a deal, he needs
   both. Recommend allowing a toggle rather than a hard either/or.
6. **What counts as activity** for `last_activity_at`? Recommended set is: note
   added, call logged, action completed, status changed. Confirm that opening a
   record or fixing a typo should not count, which is the whole point of the
   column.

---

## Design system

This build is new CRM surface area, so `design-system/` governs all of it, per
`CLAUDE.md`. Relevant reference pages:

- KPI cards, stat strips, tables, badges, empty states: `reference/03-data.html`
- The dashboard composition itself: `reference/06-patterns.html` has a dashboard
  home pattern with a KPI row, chart, needs-attention table and activity feed,
  which maps closely onto this widget set
- Alerts, toasts, dialogs for the notifications panel: `reference/05-feedback.html`
- Quick actions bar controls: `reference/02-forms.html`

Two notes specific to this page. The kit's rule is that red marks the single most
important action on a screen, so the quick actions bar gets at most one red
button. And every widget needs a real empty state, because on day one most of
them will be empty: no actions queued, no targets loaded, nothing stuck.
