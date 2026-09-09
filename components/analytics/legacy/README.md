# The Analytics page as it stood on 9 September 2026

**This is the live Analytics screen again.** It was the frozen copy of the old
page; the sales team asked for the rebuild to be rolled back, and this is what
`/dashboard/analytics` renders now.

From the business:

> sales team wants analytics page rolling back. Take that page only from
> a788cc9, don't roll anything else back.

Every file here is byte for byte what `a788cc9` held, and the only edit ever
made to any of them was repointing the imports at this folder so the copy
compiles on its own. Nothing was reinterpreted on the way back in.

## What is in here

| File | What it draws |
|---|---|
| `AnalyticsHub.tsx` | The whole screen: division ring, month by month, top customers, movement, bands, stages |
| `monthly.tsx` | The bespoke month by month chart, stacked, lines or columns |
| `donut.tsx` | The division ring |
| `bars.tsx` | Ranked and diverging bars |
| `panel.tsx` | Panel, grid and table furniture |
| `tiles.tsx` | The KPI tile with its sparkline |
| `sections.tsx` | The "needs a record" empty states |
| `texture.tsx` | Chart fills, so two division colours stay apart in dark mode |

## The one change since a788cc9

The two customer panels show ten rather than eight. The footnote under Biggest
customers has always read "Top ten are n%", which is a figure the database
works out over the real top ten, and the bars beside it were the top eight.
`SHOW_CUSTOMERS` is the one number now, and `npm run check:analytics-view`
asserts that both lists and the fetch behind them agree with it.

## What is NOT live, and where it went

The rebuilt hub is still in the repository and still builds. It is not routed
to. These are the pieces, and they come back together:

| Still on disk | Was routed at |
|---|---|
| `components/analytics/landing.tsx` | `/dashboard/analytics` |
| `components/analytics/drilldowns/*.tsx` | `/dashboard/analytics/{revenue,pipeline,customers,stock,fleetsmart,people}` |
| `components/AnalyticsHub.tsx`, `components/analytics/kit/*`, `lib/analytics/*` | the shared engine behind all of it |

`landing.tsx` still links to those six routes, so **restoring it means
restoring the route files in the same change**, or the Look deeper cards go
nowhere. `app/analytics-preview` mounts the whole thing, so it can still be
looked at and `npm run check:kit-diff` still measures it against the kit.

## What stayed

`/dashboard/analytics/targets` is untouched. It is not part of this page and
never was: it is the administrators' screen for setting what a division is
measured against, it is reached by typing "set a target", and this page has no
way of editing a target at all.

No migration was reverted. Every function this page calls is still in the
schema, and the ones added since only added.

## How to put the rebuild back

`app/dashboard/analytics/page.tsx` renders one component. Point it at
`@/components/AnalyticsHub`, restore the six route files under
`app/dashboard/analytics/`, and repoint the analytics entries in
`lib/command/actions.ts` and `lib/command/features.ts` at them.
`npm run check:coverage` refuses an action naming a route that does not exist,
so it will say if a step is missed.
