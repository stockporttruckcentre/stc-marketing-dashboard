# What stops a command doing something it should not

Four different things, in order, none of which substitutes for another.
Naming them separately matters, because the failure mode is describing one
of them as if it were another and then trusting it for a job it was never
doing.

```
  the command bar          hides what you cannot do            a courtesy
  our server               capability, per field               authorisation
  PostgreSQL RLS           which ROWS you may read and write   a boundary
  command_writable_columns which COLUMNS a command may name    a shape
  CHECK, NOT NULL, FK      what the data is allowed to be      a boundary
  one function, one txn    all of the changes, or none         atomicity
```

## The bar is not a boundary

`lib/command/actions.ts` filters on capability before scoring, so a viewer
typing "elevate dave to admin" is offered nothing. That exists because an
action which appears and then refuses teaches people the tool is
unreliable. It is not what stops the write. Everything a browser sends is
a request from an untrusted party, and the request that matters is the one
that never came from the bar.

## Our server authorises, per field

`lib/command/authorise.ts` is the one call. It looks the field up in the
same dictionary the parser reads and checks the actor's capabilities
against the requirement that field declares. The lookup and the check are
one call on purpose: two calls is two places for one of them to be
forgotten, and it is always the second.

`app/api/command/edit/route.ts` calls it before anything is resolved or
written. `scripts/command-authority-check.ts` sweeps every writable field
against all four roles in both directions, so a field added later is
covered without anybody writing a case for it.

## PostgreSQL enforces rows, not columns

Row level security decides which rows somebody may see and change.
`command_apply` is `SECURITY INVOKER`, so a row the caller could not update
on their own is a row it cannot update either, and it fails loudly rather
than changing nothing:

```sql
GET DIAGNOSTICS affected = ROW_COUNT;
IF affected <> 1 THEN
  RAISE EXCEPTION 'expected to change exactly one row of % but changed %', ...
```

`command_writable_columns` is a **writable-shape boundary, not an
authorisation boundary.** It says which columns a command may ever name,
whoever is asking. It knows nothing about who the caller is and cannot,
because it is a two column table of names. It exists so that a payload
reaching `command_apply` from anywhere at all cannot name a column the
command bar was never meant to write, and it is generated from the
canonical registry by `npm run gen:writable-columns` so the two cannot
disagree.

## The gap, which is real

Application capabilities are finer than the table level policies
underneath them.

| Application says | The database says |
|---|---|
| `crm.assign` is needed to change `assigned_to` | `crm_update` is `current_role_safe() IN ('admin','marketer','sales')` |
| `marketing.approve` is needed to change a post's `status` | `social_update` is `current_role_safe() IN ('admin','marketer')` |

So at the database level a marketer may write any writable column of any
contact they can see, including `assigned_to`, and any column of any post,
including `status`. The only thing enforcing `crm.assign` and
`marketing.approve` is our own server, which means those two capabilities
hold for writes that come through our own write path and not for anything
that reaches PostgREST directly with a Supabase key.

**This is existing security debt, and it predates the command bar.** Every
screen in this application writes through PostgREST with the same coarse
permissions. It is recorded here rather than fixed here for two reasons:
fixing it properly means moving database access behind our own server
layer, which is a project rather than a change; and fixing it by adding
column level policies to every table would be a second copy of the
permission model that nothing can demand be kept in step with the first.

The order of work is: keep the canonical authorisation as the single
statement of who may write what, move database access behind our own
server layer, and then the coarse policies stop being reachable rather
than being duplicated.

## Steps that need each other are refused

Every change in one command goes to the store in one call, and they are
all computed from the rows as they stood before any of them. That is right
for steps that have nothing to do with each other and silently wrong for a
step meant to run after another: it reads the old value, writes a number
that was never true, and reports success.

`lib/command/ir/dependence.ts` refuses the whole plan when one step
consumes another's result, reads a field another writes, or touches a row
another touches. Sequencing dependent effects needs a transaction that can
run them in order, which is a thing the store can be given later.

## Where the SQL is proved

`scripts/sql/validate-007.sql`, against a real PostgreSQL 16 built from
this repository's own schema and migrations by
`scripts/sql/build-test-db.sh`. 48 assertions covering types, constraints,
the allowlist, atomicity, list visibility with every policy enabled, and
`command_mark_sold`. There is no test-only row level security bypass: the
policies it runs against are the policies in this repository.
