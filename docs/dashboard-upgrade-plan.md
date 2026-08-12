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

**A granular permissions system is coming, and the platform is moving off
Supabase.** Read "The platform move changes this build" below before implementing
this. The column still gets added, but nothing should read it directly, and the
capability model behind it should not depend on `auth.uid()`.

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

## The platform move changes this build more than the spec does

Three things are now confirmed, and together they matter more to the dashboard
than anything in the meeting notes:

1. The CRM leaves Supabase for **local PostgreSQL on your own servers**.
2. **SSO comes after that move**, not with it.
3. Permissions are **CRM-native**. Entra handles who you are, the CRM handles
   what you may do, because IT owns Entra and you need full admin control here.

Point 3 is straightforwardly good news and closes an open question. Points 1 and
2 are the ones that reshape the build.

### What leaving Supabase actually costs

Supabase is not the database in this app. It is the database, the auth service,
the API layer, the realtime engine and the file storage, and the code leans on
all five. Measured against the current tree:

| What Supabase provides | Uses in this codebase | On plain PostgreSQL |
|---|---|---|
| Postgres | Everything | Straight swap. The easy part |
| **PostgREST (browser to database)** | **75 `supabase.from()` calls inside client components** | **Does not exist. Every one becomes a server API call** |
| `auth.uid()` / `auth.role()` in RLS | 36 policy expressions | Rewrite to read a session variable |
| Supabase Auth | 9 distinct methods, 29 `getUser()` calls, 6 foreign keys to `auth.users` | Replaced wholesale |
| Realtime | 3 subscriptions covering `crm_contacts`, `calendar_events`, `contact_addresses` | No equivalent. Needs `LISTEN`/`NOTIFY` plus sockets, or polling |
| Storage | Brand kit and social planner uploads | Local disk or S3-compatible store |
| PostgREST query DSL | ~36 constructs (`.or()`, embedded `crm_lists(name)`, `count: 'exact'`, `.range()`, `.maybeSingle()`) | Hand-written SQL. Not a driver swap |

**The 75 number is the headline.** Today the browser talks to the database
directly, and RLS is what makes that safe. There is no PostgREST in front of a
local PostgreSQL server, and exposing that server to browsers over the internet
is not an option anyway. So every one of those calls has to move behind a
server-side API route. That is not a port, it is a re-architecture of how the
front end gets its data, and it lands on the CRM grid, the tracker, the stock
list and the calendar, which are the four heaviest screens in the product.

### Which means the dashboard has a sequencing decision to make now

Building the dashboard's nine widgets in the current browser-direct style adds
roughly thirty more calls to the seventy-five that already have to be rewritten.
Waiting for the migration instead delays a soft-launch blocker by months.

**Recommendation: build every dashboard widget against server-side API routes
from the first commit, even while still on Supabase.** No widget calls the
database from the browser. Three reasons:

1. The exec view has to work this way regardless. RLS deliberately hides each
   rep's tracker, so company-wide aggregation was always going to be server-side.
   Half the dashboard is already being built in the post-migration style.
2. When the platform moves, the swap happens inside those routes. The widgets do
   not change at all.
3. It is the same principle as the permissions accessor: put the seam in once,
   in one layer, rather than in nine places later.

The cost is real but small: server routes plus a fetch layer instead of direct
queries, and realtime on the dashboard becomes polling or is dropped. The saving
is not having to rewrite the newest screen in the product weeks after shipping it.

### Consider whether you need to leave Supabase, or only to leave their servers

Worth separating two decisions that are easy to merge. "Move to local
PostgreSQL" and "stop using Supabase" are not the same thing. The whole Supabase
stack is open source and can be self-hosted on your own hardware with Docker,
which would keep auth, RLS, PostgREST, realtime and storage working almost
unchanged, and turn most of the table above into an infrastructure task rather
than a rewrite.

There may be good reasons to reject that: IT policy, wanting no third-party
software in the stack, support arrangements, or simply preferring plain
PostgreSQL you fully understand. This is not a recommendation either way. But the
difference between the two paths is months of engineering, so it is worth being a
deliberate choice rather than a side effect of the phrase "moving to local
servers".

### The interim auth gap

SSO arrives after the move. Supabase Auth leaves with the move. Something has to
authenticate people in between, and it is easy to plan around this gap without
noticing it exists.

**Recommendation: replace Supabase Auth with a self-hosted auth library at
migration time, configured with username and password to start.** When SSO
lands, Microsoft becomes an additional identity provider on the same library and
the same users table. That makes SSO a configuration change rather than a second
auth migration.

Doing it the other way, patching in something temporary and replacing it when SSO
arrives, means migrating identity twice, and identity migrations are where the
data-loss risk lives.

### The UUID warning moves forward, it does not go away

The last version of this plan warned that SSO could orphan every rep's tracker if
new user IDs were minted. That risk now belongs to the **Supabase to local
migration**, which happens sooner.

Six tables key off `auth.users.id`: profiles, tracker list ownership, list
sharing, maintenance accounts, note authorship and calendar event ownership. Two
of those cascade on delete, so getting it wrong destroys data rather than just
detaching it. Worst case is unchanged: tracker ownership goes null, the policy
that returns a rep's own lists checks exactly that field, and every rep is locked
out of their own pipeline while the rows sit intact.

**So the migration rule is: export `auth.users` and keep the existing UUIDs as
the primary keys in the new `users` table.** Do not let the new system generate
fresh IDs. Verify by signing in as one rep on a restored copy and confirming
their tracker, notes and meetings all resolve before cutting over.

### Design the permission model for plain PostgreSQL, not for Supabase

Since permissions are CRM-native and the platform is moving, the capability model
should be written now in a form that survives the move. Concretely, avoid
`auth.uid()` in anything new. Use a session variable that both platforms can set:

```sql
-- works on Supabase (set from the request) and on plain PostgreSQL (SET LOCAL)
CREATE OR REPLACE FUNCTION app_user_id() RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION has_capability(cap TEXT) RETURNS BOOLEAN
  LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_capabilities uc
    WHERE uc.user_id = app_user_id() AND uc.capability = cap
  )
$$;
```

Every new policy then reads `has_capability('crm.write')` rather than a hardcoded
role list, and the 36 existing `auth.uid()` and `auth.role()` expressions become
a mechanical substitution at migration time instead of a redesign.

One decision to take deliberately: **does RLS survive the move, or does
authorization move into the application?** Keeping RLS on plain PostgreSQL means
setting the user context on every connection checkout, which is a real
requirement to get right with a connection pool, and the failure modes are
silent. Dropping RLS means rewriting the entire authorization model in
TypeScript, with no database-level safety net. Given RLS is currently the only
authorization layer this app has, keeping it is the safer path, but it needs the
connection layer built carefully.

### Meetings: the CRM being master resolves the design, and creates a firewall problem

The CRM being the system of record settles it. The `owner_user_id` column and the
calendar policy rewrite described below are the right design, and
`calendar_events` stays authoritative. Add three columns for the sync itself:
`graph_event_id`, `graph_etag`, `last_synced_at`.

"Perfect sync" is the hard part, and two things about it are worth knowing before
it is scheduled.

**A two-way sync needs loop protection.** The CRM writes to Outlook, Microsoft
notifies the CRM of the change, the CRM writes again. Every two-way calendar sync
has to break that cycle, usually by storing the etag of the version it just
wrote and ignoring notifications that match. Conflict resolution also needs a
rule: if the same meeting is edited on both sides between syncs, the CRM wins as
master, but that has to be a decision written down rather than an accident of
implementation.

**Push notifications need Microsoft to have a route to the server.** Graph is
free in both directions and push is fully supported, so cost and capability are
not the question. The question is reachability: a Graph subscription delivers by
calling a `notificationUrl` that Microsoft's servers must be able to reach, and
Microsoft validates that URL when the subscription is created. A CRM on the
internal network alone cannot receive that call.

Three ways to solve it, all of them ordinary:

1. **Deliver to Azure Event Hubs instead of a webhook.** Graph subscriptions can
   target Event Hubs rather than an HTTPS endpoint, and the CRM then reads from
   it outbound. Nothing is exposed inbound at all. This is the neatest fit for a
   server that stays behind the firewall, and it is worth pricing before
   assuming a DMZ is needed.
2. **Expose one endpoint.** A reverse proxy or DMZ host that accepts only the
   Graph notification path. Standard, but it is a hole in the perimeter that
   somebody has to own.
3. **Poll delta queries on a timer.** No inbound anything. Free, simple, and for
   a calendar a one to five minute cycle is usually indistinguishable from push
   to the people using it. It only stops being "perfect" if the requirement is
   genuinely sub-minute.

None of these blocks the build. It is a network decision that belongs to whoever
plans the local hosting, and it is worth taking early rather than at integration
time.

**Writing into other people's calendars still needs IT.** Delegated meetings, Tom
booking in Dave's diary, require application-level Graph permissions and tenant
admin consent. You control CRM permissions, but this specific piece still depends
on the same IT team that owns Entra. Worth flagging now so it is not discovered
at integration time.

### The Office ribbon is further out, and it argues for the same decision

A custom ribbon and task pane in Outlook is on the roadmap. It does not need
planning yet, but two things about it should influence choices being made now.

**An Office add-in is a web app, so it consumes the same API.** Modern add-ins
are HTML and JavaScript loaded into an embedded browser inside Office, declared
by a manifest and served over HTTPS. A ribbon button that says "log this email
against the customer" or "create a prospect from this thread" is a small page
calling the same server routes the dashboard uses. That is a second, independent
reason for the API-first recommendation above: the layer built for the dashboard
is the layer the ribbon will run on. Build it browser-direct and the add-in
starts by building it again.

**It raises the reachability question a third time.** Office fetches add-in
content from wherever the manifest points, so the CRM has to be reachable by the
Office clients using it, which includes Outlook on the web and on phones if those
are in scope. Combined with Graph notifications and any remote access to the CRM
itself, that is three separate features all asking the same question about the
network posture of a server on the internal LAN. Worth answering once,
deliberately, rather than three times under deadline.

**Batch the Entra requests.** Add-in sign-on, Graph delegated calendar scopes,
Graph application scopes for delegated diaries, and SSO itself all live on the
same Entra app registration. Since IT owns that tenant and each consent request
is a separate conversation with another team, it is worth designing the
registration once against the full roadmap rather than going back for one scope
at a time.

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
| 6 | Meetings today / this week | `calendar_events` now, Microsoft Graph `/me/events` later | Moves with SSO, not after it. Own diary is easy; delegated diaries need app-level Graph consent |
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

1. Fix `profiles_update_self` so the variant column is not self-writable. This is
   also the pattern the coming permission system depends on, so it is worth doing
   properly rather than patching.
2. Add `dashboard_variant`, the Team screen control, and the
   `getDashboardVariant()` accessor. Nothing reads the column directly.
3. Add `last_activity_at` and write it from the note, status and action paths.
4. Confirm the live schema matches `supabase/schema.sql`. The file references
   `is_list_member_safe()`, which is defined nowhere in the repo, so the file
   and production have already diverged. Dump the real schema before writing
   migrations against this one.
5. Agree the capability function signature with whoever is designing the
   permissions panel, so the nineteen role-hardcoded policies can be migrated by
   substitution later rather than redesigned. Write it against `app_user_id()`,
   not `auth.uid()`, so it survives the platform move.
6. Decide the dashboard's data-access rule before widget one: server-side API
   routes only, no browser-direct queries. This is what keeps the dashboard out
   of the 75-call rewrite when the platform moves.

**Tier 1, soft launch.** Widgets 1, 2, 3, 4, 5, 7, 9, plus role rendering with a
basic exec view. Note that widget 7 is a full build and widget 5 needs the
ownership backfill, so this tier is larger than the widget count suggests.

**Tier 2, weeks 3 to 8.** Widget 6, widget 8 (once targets are loaded by hand,
independent of Protean), and the full exec view.

Widget 6 is now tied to the SSO date rather than sitting behind it. If SSO lands
during Tier 1, the user's own meetings can ship with it, because the calendar
scope comes from the same sign-in. Delegated diaries stay in Tier 2 or later,
since they need a separate Azure app registration and probably tenant admin
consent. Do not write the calendar migration until the Outlook-or-CRM master
question is answered.

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
7. ~~Is Outlook or the CRM master for meetings?~~ **Answered: the CRM.** The
   owner column and policy rewrite stand, plus three sync columns.
8. ~~Are permissions mapped from Entra groups?~~ **Answered: no.** Entra
   authenticates, the CRM authorises. The capability model is yours.
9. **Does RLS survive the move to plain PostgreSQL, or does authorization move
   into the application?** Keeping RLS means setting user context on every
   connection checkout, with silent failure modes. Dropping it means rewriting
   the only authorization layer this app has in TypeScript. Recommend keeping
   it, but the connection layer has to be built for it.
10. **Is the requirement local PostgreSQL, or no Supabase at all?** Self-hosting
    the Supabase stack on your own hardware keeps auth, RLS, PostgREST, realtime
    and storage working. The difference between the two paths is months of work,
    so it should be a deliberate choice.
11. **How does Microsoft reach a server on the internal network?** Not a cost
    question, Graph is free both ways. It is reachability: Event Hubs delivery,
    one exposed endpoint, or delta polling. The same question returns for the
    Office ribbon and for any remote access to the CRM, so answer it once for
    the network as a whole rather than per feature.

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
