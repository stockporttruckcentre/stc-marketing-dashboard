# What the command bar has to reach

This is the sweep that should have come first.

**"The CRM" here means the whole application, not the tab called CRM.**
Login, the shell, the sidebar, the notification bell, the theme toggle,
every dashboard variant, every API operation. If a person can cause it to
happen while signed in, it belongs in this file and it belongs in the
bar. The tab is one row of the table below.

The registry in `lib/command/actions.ts` was written from the parts of the
app I happened to be working in, which is why it had thirty three entries
and nothing at all for social posts. That gap was not an oversight in one
file. It was the wrong method: building the bar's vocabulary from memory
instead of from the app.

So this is the app, read screen by screen, function by function, from the
components themselves. Every handler that a person can trigger is listed.
Anything here that the bar cannot reach is a defect, and the coverage
check asserts it.

**When you add a feature anywhere, add it here in the same change.** This
file is the source the registry is written against, and the reason the
registry can be checked for completeness rather than just for
correctness.

---

## What has actually been read

The first sweep covered sixteen components and stopped, and nothing
recorded that it had stopped. That is the same failure as writing the
registry from memory: the gap was real and invisible. So the sweep now
carries its own coverage table, and a file that has not been read
exhaustively says so.

**Read exhaustively, every line, control by control:**

| Area | Files |
|---|---|
| CRM tab | `CrmWorkspace`, `crm/ContactDrawer`, `crm/AddressMap`, `crm/ImportDialog`, `crm/ExportView`, `crm/GenerateProposalPicker`, `crm/NextActionPrompt`, `crm/ScheduleMeetingModal`, `CrmListRestore` |
| Stock and tracker | `StockList`, `SalesTracker` |
| Calendar and marketing | `TeamCalendar`, `SocialPlanner`, `BrandKit`, `IndustryNews`, `BusinessActivityStrip` |
| Database | `supabase/schema.sql`, every migration, `lib/types.ts` |
| Analytics and prospecting | `AnalyticsView`, `CompanyFinder` |
| Admin, settings, dashboards | `AdminPanel`, `SettingsPanel`, `RepDashboard`, `ExecDashboard`, `SupportDashboard`, `VariantSwitch` |
| Shell and auth | `Header`, `Nav`, `Sidebar`, `TopBar`, `ThemeToggle`, every `app/**/page.tsx`, login, signup, reset password |
| API | every route under `app/api/` |

**Deliberately out of scope**, with the reason:

| Not read | Why |
|---|---|
| `components/kit/*` | Primitives. They have no behaviour of their own, only the behaviour of whatever renders them. |
| `components/TruckIcon.tsx` | A drawing. |
| `design-system/` | A prototype, not the app. |
| `docs/source/` | Documents somebody else wrote. |

Anything not in either table has not been looked at, and that is a
defect rather than a decision.

---

## Dashboard `/dashboard`

| Function | Where | Reached by |
|---|---|---|
| Open the dashboard | `app/dashboard/page.tsx` | `nav.dashboard` |
| Switch dashboard variant (rep, exec, support) | `VariantSwitch.tsx` | `admin.dashboard` |
| Quick actions seeding the bar | `RepDashboard.tsx` | the bar itself |

## CRM `/dashboard/crm`

| Function | Where | Reached by |
|---|---|---|
| Open the CRM | `CrmWorkspace.tsx` | `nav.crm` |
| Add a contact | `handleAddRow` | `make.contact` |
| Delete selected contacts | `bulkDelete` | `rec.delete` |
| Assign rows to somebody | `assignRows` | `rec.assign` |
| Unassign rows | `assignRows(null)` | `rec.unassign` |
| Switch scope: mine, everyone, unassigned, a person | `changeScope` | `crm.scopeMine`, `crm.scopeAll`, `crm.scopeUnassigned`, `crm.scopePerson` |
| Create a list | `createList` | `make.list` |
| Delete a list | `deleteList` | `crm.deleteList` |
| Share a list with somebody | `shareList` | `crm.shareList` |
| Stop sharing a list | `unshareList` | `crm.unshareList` |
| Switch list | `selectList` | `crm.openList` |
| Search the list | search box | `crm.search` |
| Import a spreadsheet | `commitImport` | `data.import` |
| Export the view | `handleExport` | `data.exportList` |
| Enrich from Lusha | `doEnrich`, `bulkEnrich` | `data.enrich` (locked) |
| Check Lusha balance | `fetchBalance` | `data.lushaBalance` |
| Move rows to another list | context menu | `crm.moveToList` |

## Contact record `ContactDrawer.tsx`

| Function | Reached by |
|---|---|
| Edit any field | `rec.editContactField` plus `lib/command/fields.ts` |
| Add a note | `make.note` |
| Add a link (website, LinkedIn, Facebook, Instagram, X) | `crm.addLink` |
| Remove a link | `crm.removeLink` |
| Move or duplicate to another list | `crm.moveToList` |
| Link a twin account, create one, unlink | `rec.link`, `crm.unlink` |
| Add, edit, remove an address | `crm.addAddress`, `crm.removeAddress` |
| Set the primary address | `crm.primaryAddress` |
| Show the addresses on a map | `crm.showMap` |
| Generate a proposal | `make.proposal` |
| Schedule a meeting or call | `make.meeting`, `make.call` |
| Export this customer | `data.exportCustomer` |
| Open DocuSign | `rec.docusign` |

## Site map `AddressMap.tsx`

| Function | Reached by |
|---|---|
| Open the map | `crm.showMap` |
| Drop a pin | `crm.addPin` |
| Move a pin | on the map |
| Undo, redo a pin move | `crm.undoPin` |
| Make a site primary | `crm.primaryAddress` |
| Remove a site | `crm.removeAddress` |
| Re-geocode from the address | `crm.regeocode` |

## Sales tracker `/dashboard/sales` (tracker tab)

| Function | Where | Reached by |
|---|---|---|
| Open the tracker | `SalesTracker.tsx` | `nav.tracker` |
| New lead from scratch | `createBlankLead` | `make.lead` |
| Pull a lead in from the CRM | `importFromCrm` | `tracker.fromCrm` |
| Mark a deal sold, with price and commission | `MarkAsSoldModal` | `rec.markSold` |
| Move a deal's status | `TrackerContextMenu` | `rec.editContactField` |
| Duplicate a row | context menu | `tracker.duplicate` |
| Delete a row | context menu | `rec.delete` |
| Link a stock trailer to a deal | `StockTrailerPicker` | `tracker.linkStock` |
| Import a spreadsheet | `commitTrackerImport` | `data.import` |
| Commission view | `CommissionView` | `tracker.commission` |
| Switch side: trailer sales or maintenance | side toggle | `tracker.side` |
| Schedule a meeting from a deal | `handleSchedule` | `make.meeting` |

## Trailer stock `/dashboard/sales` (stock tab)

| Function | Where | Reached by |
|---|---|---|
| Open the stock list | `StockList.tsx` | `nav.stock` |
| Add a trailer | `addRow` | `make.trailer` |
| Edit any field | `StockDrawer` | `rec.editTrailerField` plus `fields.ts` |
| Add a refurb cost | context menu | `rec.editTrailerField` |
| Bulk change status | `bulkChangeStatus` | `stock.bulkStatus` |
| Bulk change location | `bulkChangeLocation` | `stock.bulkLocation` |
| Bulk delete | `bulkDelete` | `rec.delete` |
| Duplicate a unit | `duplicateRow` | `stock.duplicate` |
| Send a unit to the tracker | `sendToTracker` | `stock.sendToTracker` |
| Mark sold, with the sold guard | `changeStatusWithGuard` | `rec.markSold` |
| Import a spreadsheet | `commitStockImport` | `data.import` |
| Units with an MOT running out | column | `stock.motDue` |

## Team calendar `/dashboard/calendar`

| Function | Where | Reached by |
|---|---|---|
| Open the calendar | `TeamCalendar.tsx` | `nav.calendar` |
| Create an event | `saveEvent` | `make.meeting`, `make.call`, `make.visit` |
| Edit an event | `EventForm` | `cal.edit` |
| Delete or cancel an event | `deleteEvent` | `cal.cancel` |
| Move an event to another time | `saveEvent` | `cal.reschedule` |
| Set visibility: private or team | `EventForm` | `cal.visibility` |
| Invite somebody | `attendees` | `cal.invite` |
| Accept an invitation | RSVP | `cal.accept` |
| Decline an invitation | RSVP | `cal.decline` |
| Suggest a different time | RSVP | `cal.propose` |
| See what is on in the next seven days | `Next7Days` | `cal.week` |

## Social planner `/dashboard/social`

The tab the registry knew nothing about, which is what prompted this file.

| Function | Where | Reached by |
|---|---|---|
| Open the planner | `SocialPlanner.tsx` | `nav.social` |
| Write a post | `submit` | `make.post` |
| Pick platforms: Facebook, Instagram, LinkedIn, X | `togglePlatform` | `social.platform` |
| Upload an image | `uploadImage` | `social.image` |
| Remove the image | `setImageUrl(null)` | `social.removeImage` |
| Set the scheduled date | form | `social.schedule` plus `fields.ts` |
| Preview how it will look per platform | `setPreviewPost` | `social.preview` |
| Send for approval | `setStatus('pending_review')` | `social.submit` |
| Approve a post | `setStatus('approved')` | `social.approve` |
| Send back to draft | `setStatus('draft')` | `social.reject` |
| Schedule an approved post | `setStatus('scheduled')` | `social.queue` |
| Mark a post as posted | `setStatus('posted')` | `social.markPosted` |
| Delete a post | `deletePost` | `social.delete` |
| Count or list posts in any state | query engine | `lib/command/schema.ts` `posts` |

## Brand kit `/dashboard/brand`

| Function | Where | Reached by |
|---|---|---|
| Open the brand kit | `BrandKit.tsx` | `nav.brand` |
| Upload a logo, font, template or image | `handleFileUpload` | `brand.upload` |
| Add a brand colour | `addColor` | `brand.addColour` |
| Delete an asset | `deleteAsset` | `brand.delete` |
| Copy a hex value | swatch | `brand.copyHex` |

## Industry news `/dashboard/news`

| Function | Where | Reached by |
|---|---|---|
| Open the news | `IndustryNews.tsx` | `nav.news` |
| Refresh the feeds | `refresh` | `news.refresh` |
| Filter by source | `setActiveSource` | `news.source` |
| Search the headlines | search box | `news.search` |
| Clear the filters | clear | `news.clear` |
| Delete an item | `deleteItem` | `news.delete` |
| Company activity from the Gazette | `BusinessActivityStrip` | `news.activity` |

## Company finder `/dashboard/finder`

| Function | Where | Reached by |
|---|---|---|
| Open the finder | `CompanyFinder.tsx` | `nav.finder` |
| Search near a depot or a place | `handleSearch` | `finder.search` |
| Add one result to the CRM | `handleAddSingle` | `finder.add` |
| Add everything selected to the CRM | `handleAddBulk` | `finder.addBulk` |

## Analytics `/dashboard/analytics`

| Function | Where | Reached by |
|---|---|---|
| Open analytics | `AnalyticsView.tsx` | `nav.analytics` |
| Change the period | `periodWindow` | `analytics.period` |
| Rep leaderboard | leaderboard | `analytics.leaderboard` |
| Revenue and profit over time | charts | `analytics.revenue` |
| Split by make, status or depot | charts | `analytics.breakdown` |

## Settings `/dashboard/settings`

| Function | Where | Reached by |
|---|---|---|
| Open settings | `SettingsPanel.tsx` | `nav.settings` |
| Switch theme | `applyTheme` | `me.theme` |
| Change your name | `saveName` | `me.name` |
| Change your password | `savePassword` | `me.password` |
| Sign out | `Header.tsx` | `me.signOut` |

## Team and access `/dashboard/admin`

| Function | Where | Reached by |
|---|---|---|
| Open the team screen | `AdminPanel.tsx` | `nav.team` |
| Change somebody's role | `changeRole` | `admin.role` |
| Add a user | | `admin.addUser` |
| Set somebody's dashboard | | `admin.dashboard` |

## Export pages `/export/crm/[id]`

| Function | Where | Reached by |
|---|---|---|
| Download as Excel | `download('xlsx')` | `data.exportCustomer` |
| Download as Word | `download('docx')` | `data.exportCustomer` |
| Copy to the clipboard | `copy` | `export.copy` |
| Email it | `email` | `export.email` |
| Print or save as PDF | print CSS | `export.print` |

---

## What is deliberately not in the bar

- **Dragging a pin on the map.** A position is a gesture. Typing
  coordinates is not how anybody places a yard.
- **The reference prototype in `design-system/`.** Not part of the app.
- **Anything in `docs/source/`.** Documents, not features.
