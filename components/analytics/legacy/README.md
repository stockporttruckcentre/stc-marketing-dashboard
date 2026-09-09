# The Analytics page as it stood on 9 September 2026

Frozen. Nothing in here is imported by the live application except the one
route named below, and nothing in here should be edited: it is a copy kept so
the old page can be opened beside the new one, not a second implementation to
maintain.

## Why it is here

From the business, commissioning the rebuild:

> Currently it's a little all over the place and it doesn't offer enough
> insight to an accounts department of what they need to see at a glance in
> the morning, or spend 30 minutes delving in to. There aren't many analytics
> on the page at all, it's more a page than the hub it's supposed to be. Make
> a backup of the current page and store it in the repo then use the attached
> to create a new one.

Git history is a backup, but it is not one anybody can look at side by side
with the replacement while deciding whether the replacement is better. This is.

## What is in here

| File | What it was |
|---|---|
| `AnalyticsHub.tsx` | The whole screen: division ring, month by month, top customers, movement, bands, stages |
| `monthly.tsx` | The bespoke month by month chart, stacked, lines or columns |
| `donut.tsx` | The division ring |
| `bars.tsx` | Ranked and diverging bars |
| `panel.tsx` | Panel, grid and table furniture |
| `tiles.tsx` | The KPI tile with its sparkline |
| `sections.tsx` | The "needs a record" empty states |
| `texture.tsx` | Chart fills, so two division colours stay apart in dark mode |

The imports were repointed at this folder so the copy compiles on its own. That
is the only change made to any of it.

## How to look at it

`/dashboard/analytics/previous`. It is not in the sidebar and never will be.
It reads the same three functions the live page reads, so it shows today's
figures rather than a snapshot: it is the old **page**, not the old data.

## How to put it back

`app/dashboard/analytics/page.tsx` renders one component. Point it at
`components/analytics/legacy/AnalyticsHub` and the old screen is live again.
Nothing else has to move, because the new hub added tables and functions rather
than changing any the old one read.

## When to delete it

Once the new hub has been through a month end and nobody has asked to see this
again. Deleting it is this folder and the one route.
