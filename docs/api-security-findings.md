# Unguarded API routes

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

## What fixing it looks like

One helper, called at the top of every write route, in the same shape as
the check already in `/api/command/edit`:

```ts
const caps = capabilitiesFor({ role });
if (!caps.has('stock.edit')) return NextResponse.json(
  { ok: false, message: '...' }, { status: 403 });
```

That is a small change per route and about a dozen routes. It has not
been made yet, and it is deliberately not bundled into the command bar
work, because a security fix should be reviewable on its own.
