# Unguarded API routes

**Status: fixed.** Every route below now calls `requireCapability()` from
`lib/api/guard.ts` before it writes. This file stays as the record of
what was wrong and why, because the next person to add a route needs to
know the shape of the mistake, not just that it was made.

Found by reading all 31 route files under `app/api/`. Nothing here is
theoretical: every line names the route, what it writes, and what it
fails to check.

The pattern is the same throughout. `lib/crm/permissions.ts` defines
capabilities, the command bar filters on them, and `/api/command/edit`
checks them per field. Almost nothing else does. The comment in
`mark-sold` says "RLS handles ownership", and for the rows a person owns
it does. It does not express "a viewer may not create stock", because
that is a statement about a role, not about a row.

---

## Writes with no role or capability check at all

| Route | What it writes | Missing check |
|---|---|---|
| `/api/command/execute` | `crm_contacts`, `stock_trailers`, `calendar_events` | None. Five insert paths in one switch: create_prospect, create_stock_trailer, schedule_call, create_contract, create_proposal. **A viewer can create stock and leads.** The sibling route `/api/command/edit` checks capabilities per field; this one checks nothing. |
| `/api/tracker/mark-sold` | `crm_contacts` twice, `stock_trailers` | `stock.edit`. Writes sale price, profit and commission, flips a trailer to sold, and mutates **other reps' tracker rows**. |
| `/api/crm/import` | up to 5000 `crm_contacts` rows | `crm.import` exists as a capability and is never consulted. |
| `/api/crm/proposal` | `crm_contacts` | `crm.proposal` exists and is never consulted. |
| `/api/crm/link` | `crm_contacts` | None. Rewrites `parent_customer_id` on arbitrary contact ids. |
| `/api/crm/follow-up` | `dashboard_actions`, `crm_contacts` | None. On failure it silently stamps `last_contact` on any contact id passed in. |
| `/api/tracker/send-from-stock` | `crm_contacts` | None. |
| `/api/trailers/sync` | `trailer_sales` | None, and no row-count cap. |
| `/api/news/fetch` | `news_items` | None. **Any signed-in user can trigger a DELETE of every 'Road Transport' row and everything older than the cutoff.** |
| `/api/lusha/enrich` | `crm_contacts`, `contact_addresses` | Only the global `LUSHA_LOCKED` switch. The per-user `crm.enrich` capability is never checked, so lifting the switch grants it to everybody at once, which is the opposite of what the meeting asked for. |
| `/api/admin/seed-demo` | seven tables | Admin is checked **only** when `email` names another account. A viewer seeding or wiping themselves passes with no role check, and the `stc_no LIKE 'DEMO-%'` delete is not scoped to the caller. |

## Reads that cross RLS on purpose

Four routes open a direct `postgres` connection, which is not subject to
row level security. Three of them do it for a defensible reason and
withhold the sensitive column. One does not.

| Route | Crosses RLS to | Guard |
|---|---|---|
| `/api/dashboard/exec` | Aggregate every rep's private tracker | Auth only. **Any signed-in user gets company-wide revenue.** No exec or admin check. |
| `/api/stock/sold-warning` | Read other reps' tracker rows | Auth only, **and it returns their `commission`**, which the other three deliberately withhold. |
| `/api/stock/sold-info` | Read other reps' tracker rows | Auth only. Commission correctly omitted. |
| `/api/tracker/check-link` | Read other reps' tracker rows | Auth only. Narrowed to first name, status, price, date. |

`/api/admin/diag-reps` is read only but exposes every rep's sold volume,
revenue and profit, under an `/admin` path, with no admin check.

## Not a finding, worth recording

No route uses the Supabase service-role key.
`createServiceRoleClient()` exists in `lib/supabase/server.ts` and has no
callers anywhere. The RLS bypass in production is the raw `postgres`
connection above, not that function.

---

## What was done

`lib/api/guard.ts` holds one helper:

```ts
const gate = await requireCapability('stock.edit');
if (!gate.ok) return gate.response;
const { supabase, user, caps } = gate;
```

Applied to all eleven write routes, plus:

- `/api/command/execute` gates **per intent**, not per route, because
  the same endpoint creates prospects, stock, meetings and proposals and
  those are four different permissions.
- `/api/dashboard/exec` now returns `{available: false}` with a sentence
  rather than company-wide revenue, unless the caller is an
  administrator. One line changes when a manager role exists.
- `/api/lusha/enrich` checks `crm.enrich` as well as the global lock, so
  lifting the lock does not hand enrichment to everybody at once.
- `/api/stock/sold-warning` no longer selects `commission`. Sold-info and
  check-link cross the same RLS boundary and both withhold it; the exec
  view says out loud that commission stays between a rep and their own
  tracker. This route disagreed with all three. The sale price stays,
  because the warning is about a sale being undone.
- Refusals name the missing permission rather than saying "no access",
  so somebody knows what to ask an administrator for.
