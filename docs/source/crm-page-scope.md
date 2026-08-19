# CRM Page-by-Page Scope — From Tom / Dave / Alex Meeting

Source: `TOM DAVE CRM CHAT.md` (~1h20 transcript)
Participants: **Tom Moore** (rentals/fleet), **Dave** (senior sales — trailer sales & existing portfolio), **Alex Ellis** (building the CRM).
Purpose: hand another Claude a per-page build spec derived from the meeting. This document EXCLUDES the Dashboard / Workspace Overview and News page (already documented / excluded).

Provenance is preserved on every item so the next Claude knows who asked for it. "Existing" describes what is already in the CRM before this meeting; "From the meeting" is what was requested / changed / complained about in the session.

---

## 1. CRM (Contacts)

### Current state (brief)
Main contact/account management tab. Uses AG Grid with a contact drawer, notes, enrichment via Lusha, and lists. Alex demonstrated a "global" CRM pipeline visible to anyone with CRM rights, and the ability for each user to create custom lists and add new contacts into them. Import from Excel works — Alex imported Dean's tracker (which itself was split trailer sales / maintenance). Contacts can be right-clicked to "Move to list" and added to the user's sales tracker.

### From the meeting

**New features requested:**
- **"Generate Proposal" action on the customer account** — Tom's central proposition. On an existing customer's CRM record, a button asks *"What would you like to generate a proposal for? Trailer sales, maintenance, or rental?"* Clicking routes into one of three flows (see section 14, Proposal Generator flows). Trigger point is inside the contact drawer for existing customers.
- **"What to do next?" prompt after adding a new prospect** — raised by Tom. When a fresh (non-existing) contact is added, the system should surface next-step options (proposal, schedule follow-up, add to tracker, etc.). Wording still TBD.
- **Separate visibility of proposals to prospective vs existing customers** — Tom wants prospective-customer proposals and existing-customer proposals split. Preferred surface is the main Dashboard (out of scope here), but the CRM record itself should carry the "prospect" vs "existing" flag that drives the split.
- **DocuSign shortcut** — button on a converting prospect that opens the DocuSign home page (do not attempt to pre-populate an envelope). User logs in (or is auto-logged if browser remembers), builds the envelope themselves, adds their template (Sales & Leasing DV mandate template, or STC Group DV mandate template — Tom keeps two because sales-leasing and workshop are separate business entities per Julie). Explicit note: **CRM will NOT replace DocuSign** because CRM sits behind VPN and generated links are files, not signable documents.
- **AI-style natural-language search bar at the top of the app** — raised by Alex ("has built one before, should be quite easy"). Example query Tom loved: *"How many invoices have I raised for Bishopgate in the past eight months?"* Answers from live Protean-fed data. Not strictly CRM-only, but Alex is prioritising it as part of the contact-driven workflow.
- **Restricted-access role for e.g. Rama** — she should be able to update stock/contacts as if she were updating the spreadsheet, but nothing more. Alex to wire via Admin Panel (see section 9).

**Changes to existing features:**
- **Allow the same account to sit in both Trailer Sales AND Maintenance tabs of the tracker** — because a maintenance customer may become a trailer-sales customer (and vice versa) without needing a duplicate account. Tom: *"If you've got Joe Bloggs Transport, they're a maintenance customer… you go and see them, want some rental — you don't need to re-enter that account separately."*
- **Bi-directional sync between the CRM record and the legacy Excel files during transition** — Tom explicitly wants: update the CRM, the file updates; update the file, the CRM updates. Runs for a period (Tom mentioned three months) after go-live until the team trusts the CRM enough to bin the spreadsheets. Dependency on ITG server (see section 15).
- **Auto-flag existing accounts moving into "active" status via Protean** — when a converting prospect signs, is credit-checked, and becomes active in Protean, the CRM should recognise that and *automatically* move them from prospect list to the user's portfolio. Currently that promotion is manual via "Move to list."
- **Add-stock flow fields** — Dave noted the current "add a record" form doesn't force stock number first (Dave's actual workflow is: type stock number → Bronwyn allocates STC numbers → then details). Reorder fields so stock number is first; Alex acknowledged the form probably has too many fields anyway.

**Bugs / complaints raised:**
- The current "add record" inline row entry is *"a little complicated"* per Dave — he prefers the web-flow modal.
- Move-to-list terminology confusing — Tom had to explain to Dave that "move to list" means move onto the user's sales tracker, not "move because you've lost or won them." Consider renaming / adding help text.
- Dean has been sending PROPOSALS via DocuSign (not just contracts) — Tom to put a stop to it because DocuSign charges per signing envelope. Not a CRM bug directly, but the "Generate Proposal" flow needs to make the non-DocuSign path obviously easier so this behaviour dies.

**Data / reporting additions:**
- Once Protean is wired in, each contact should surface per-account revenue and per-account invoice volume vs last year (see Analytics for the fuller ask). On the individual contact record, that means at minimum a KPI band showing this-year revenue, prior-year revenue, this-year invoice count, prior-year invoice count.

**Dependencies / integrations that affect this page:**
- **Protean integration** for account-active status and revenue-per-account (Wayne dependency).
- **ITG server** for both the CRM/file bidirectional sync and for Protean report ingestion.
- **Sales & Leasing Protean** — Alex currently has no access; needs a person with sales-leasing access to explain how accounts are created there.

**Open questions / decisions needed:**
- What exactly does the "What to do next?" prospect prompt offer? Options list TBD.
- Should the DocuSign shortcut attempt any pre-population (e.g. customer email) or purely open a blank home page? Meeting settled on "just open home page" but Alex flagged it could later capture stuff — needs confirming.
- Rama's exact permission scope — write access to stock only, or broader?

### Priority hint (from meeting emphasis)
**Tier 1.** The CRM is the "central tool" per Tom. The Generate-Proposal button and prospect→active auto-promotion are the two biggest asks and both live here.

---

## 2. Sales Tracker

### Current state (brief)
Per-user tracker with Working / Customer / Lost tabs, commission calculations, and links to stock. Currently split into two tabs — Trailer Sales and Maintenance — because Dean's imported tracker had that structure. Contact records here carry notes, actions, and scheduled meetings (which sync to the Team Calendar).

### From the meeting

**New features requested:**
- **Add a THIRD tab: Rental & Leasing** — Tom explicit: *"We'll have to add in a third tab for rental and leasing, won't we?"* This mirrors the trailer sales / maintenance split already in place. Note there is currently no rental-specific data in the imported set; will need real allocations once Sales & Leasing Protean access is sorted.
- **"Inactive prospect" auto-alert** — Dave: if you've proposed to a customer and 7–14 days pass with no progress, the system should nudge the user. Tom liked *"sort of thing… cartoon boxing glove."* Trigger threshold: Dave floated 2 weeks, Tom softened to 7 days — decide before build.
- **Target setting per user** — sensitive data, so load-in mechanism to be agreed later. Per-month, per-year targets, tied to revenue coming out of Protean.
- **Radar / progress chart per user showing revenue vs target for the month** — Tom: *"That would be like end game as a CRM from a sales point of view."* Lives on the tracker (per user) but also feeds the Dashboard.
- **Delegation** — Dave: he takes a sales call while Dean is on holiday for 10 trailers → he wants to schedule a call/reminder into Dean's calendar/tracker directly. Tom confirms this exists for meetings but wants the pattern generalised to call-back reminders and prospect handoffs. Cross-refs Calendar (section 6).

**Changes to existing features:**
- **Move-to-list flow** — feed into the newly-added Rental & Leasing tab, not just Trailer Sales / Maintenance. The Excel-import currently drove the tab structure; Alex will need to make the tabs first-class rather than data-driven.
- **Same customer, multiple tabs** — related to CRM item above; the tracker must support the same account appearing in Trailer Sales *and* Maintenance (*"potentially you could — duplicate the… there will be maintenance customers you then link to that you then start trading with"*).

**Bugs / complaints raised:**
- Migration mis-categorisation: some records ended up on the maintenance tab purely because Dean's spreadsheet had them there. Alex to make tab assignment explicit rather than inferred from import.

**Data / reporting additions:**
- Per-user pipeline value (Dave wants his displayed prominently on his tracker view *and* his dashboard — *"pipeline, 5 million"* was the illustrative figure).
- Provisionally-sold trailers (deposit pending) should be a distinct pipeline slice — 10 trailers sold-pending-deposit as an example.

**Dependencies / integrations that affect this page:**
- **Protean revenue feed** — required for the target-vs-actuals chart.
- **Notifications system** — required for the "inactive prospect" alert. That system exists in Alex's earlier work but is not currently wired in this build (see section 15).

**Open questions / decisions needed:**
- Inactive-prospect nudge threshold — 7 days vs 14 days.
- How to load per-user targets (form entry, Excel import, or Admin panel) — sensitive info, no answer settled.
- How to visualise the same account in two tabs — one record with two flags, or two linked records?

### Priority hint
**Tier 1.** The third tab (Rental & Leasing) is a blocker for Tom's own use of the CRM. Inactive-prospect nudge is Tier 2. Target-vs-actuals chart is Tier 2 but explicitly gated on Protean.

---

## 3. Trailer Stock

### Current state (brief)
The 15-sheet consolidated stock table exists with a drawer for individual records, a mark-as-sold action, and a refurbishment cost field. Data was seeded from the imported stock list. MOT details are stored and sortable/filterable, but Tom flagged the sort/filter path as *"not user-friendly."*

### From the meeting

**New features requested:**
- **"Trailers with 6+ months MOT" quick view** — Tom's specific ask: because the tracker sheet is used for rentals too, when a customer asks *"can I have a quick spin,"* he wants a single-click view that says "you have 40 trailers with 6+ months MOT — here's the breakdown." Alex says it's already possible via filters but agrees a purpose-built quick view is needed.
- **Refurbishment description / notes field** — currently refurb cost is a bare number; no way to know what it was spent on unless you dig through invoices. Dave has started manually adding notes but it's messy. Add a structured description field alongside refurb cost so the stock drawer surfaces "£1,550 curtains" rather than a bare "£7,500."
- **Refurbishment pricing matrix (drop-downs)** — Tom's long-term vision: dropdowns for "new curtains," "wheel refurb," "front," "back," "chassis," etc. Each has a default cost (curtains ~£1,000 as illustrative) which flows into the trailer's refurb cost and net book value automatically, with an option to override. Requires a sit-down with Shaggy to agree per-trailer-type baseline costs (*"Shaggy stands firm on his costs, we've all agreed that's what you can charge us"*). Flagged as later-phase — *"we're ages away from that."*
- **Auto-update net book value when refurb cost is added** — already done per Alex; call out explicitly so the description field doesn't break that pipe.
- **Refurbishment capability Gantt chart** — Tom's aspirational ask: if Dave sells 10 trailers requiring refurb, the system shows Renbury's capacity and returns an estimated completion date for each trailer. Tom explicitly labelled this "ages away." Dave was sceptical. Park for later.

**Changes to existing features:**
- **Field order in the add-stock form** — stock number first (Dave's workflow). Reduce total field count.
- **Bi-directional file ↔ CRM sync** — as with Contacts, for the transitional period the stock file and the CRM stock table must stay in lock-step. Same ITG server dependency.

**Bugs / complaints raised:**
- Refurb-cost history is essentially opaque without notes; historic entries lack context (*"absolutely no notes in there of what it's for"*).
- Notes section currently gets abused for refurb detail — will get messy at scale.

**Data / reporting additions:**
- Stock-by-manufacturer count already exists on the dashboard — Dave approved.
- Once the refurb description field is in, stock drawer should show a per-refurb line-item list (date, item, cost).

**Dependencies / integrations that affect this page:**
- ITG server for bidirectional file sync.
- Shaggy conversation for the refurb pricing matrix values.
- Long-term Renbury capacity data feed for the Gantt chart (undefined).

**Open questions / decisions needed:**
- Per-trailer-type refurb baseline costs — need Shaggy meeting.
- Whether the Gantt/capability chart happens at all — depends on whether Protean's replacement (Transora?) offers similar.

### Priority hint
**Tier 2.** The 6-month-MOT view and refurb description field are quick wins Tom wants soon. The refurb matrix and Gantt chart are Tier 3 (later phase).

---

## 4. Maintenance Accounts

### Current state (brief)
Per-user category A/B/C rows for existing maintenance accounts.

### From the meeting
No specific items raised in this meeting — page assumed to remain as-is. The meeting touched on maintenance accounts through the CRM (same account may appear as both maintenance and trailer sales) and Analytics (per-account revenue / job-volume tracking) but did not name this page or ask for on-page changes. The Protean feed that surfaces per-account revenue will improve this page's data once wired.

### Priority hint
Tier 3 — nothing raised.

---

## 5. Analytics

### Current state (brief)
Existing Analytics tab gives a drilled-in financial view: KPIs, charts, leaderboards. Currently powered by imported stock data. Alex demonstrated *"top customers by revenue"*, top-10 deals, stock-by-manufacturer, per-user leaderboard (*"obviously Lewis is killing it"*).

### From the meeting

**New features requested:**
- **Year-on-year per-account comparison** — Tom's flagship ask. For each account, take last billing financial year, average across 12 months, then compare this month vs same-month-last-year. Surface alerts on the CRM (and per-account view) for *"this account has dropped below where it was tracking last year"* or *"10% more this month than same month last year."*
- **Per-account invoice volume tracking** — Tom pushed one step further. Example: *"A&A Scaffolding — the whole of last year it did 421 separate invoice jobs. So far this year, that many."* Track invoice count trend alongside revenue trend, because volume shows usage even where revenue can be lumpy.
- **Spike / drop alerts on major changes** — Dave's idea. Any account that suddenly spikes OR drops materially should surface an alert. *"If somebody spikes you wanna see it. If somebody drops you wanna see it."* Threshold unspecified.
- **Simpler / summary view for Gareth (and other non-daily users)** — Tom: Gareth will log in and go straight to Analytics; give him a much simpler view than what Wayne/Tom would use.
- **Automated weekly email report to Gareth** — Tom wants a scheduled flashpoint update emailed weekly, per person or for the group. Alex confirmed reports can be automated.

**Changes to existing features:**
- Alex noted the current top-customers view already shows 20 deals / £18k profit slices — Tom liked the format, no change requested there.
- Revenue-per-account figures should replace or annotate the current dummy figures once Protean is wired.

**Bugs / complaints raised:**
- Currently only dummy data — Dave noted he'd want to see his actual sales contacts / allocated portfolio before he can judge navigation.

**Data / reporting additions:**
- Every existing chart needs a Protean-fed real-data variant.
- Per-user revenue-vs-target visualisation (radar suggested).

**Dependencies / integrations that affect this page:**
- **Protean** — nightly report at midnight, available by 6–7am. Meeting settled on "once every 24 hours out of working hours" as the sync cadence. Live-connection is not feasible per Alex.
- **Wayne** — Tom to tee up a call between Alex and Wayne on Protean access, because Alex is admin-account inside Protean and can't see reports.

**Open questions / decisions needed:**
- Threshold for spike/drop alerts (5%? 10%? absolute-value floor?).
- What Gareth's simplified view should contain — needs Gareth's input directly.
- Whether Wayne's choice of new operating system (Transora is one candidate; Wayne hasn't finalised) supersedes this Protean-report approach.

### Priority hint
**Tier 1.** Tom repeatedly said the revenue-per-account piece is *"kind of the most important thing to know"* and *"there's no point in doing a CRM half-arsedly"* — meaning if this doesn't get built the whole CRM risks being an add-on to Outlook calendar.

---

## 6. Calendar

### Current state (brief)
Team calendar with meetings that sync from the "Schedule meeting" action on a customer's CRM record. Alex demonstrated inviting other users to a meeting, which puts it on everyone's calendars.

### From the meeting

**New features requested:**
- **Schedule call reminders (not just meetings)** — Dave's ask: he needs to phone SMH Transport in a week to follow up a quote. Current "schedule a meeting" pattern should extend to "schedule a call." Flashes up in a week as a job to do.
- **Outlook sync** — user should get the calendar/reminder in Outlook and therefore on their phone. Tom: *"If you're on the road all day and you forget to look at your CRM… hopefully the system could send it as an Outlook calendar reminder."* Alex confirmed it can email; the full Outlook bi-directional sync depends on ITG.
- **Delegation of calendar items across users** — Dave takes a call for Dean while Dean is on holiday → Dave adds a diary entry into Dean's calendar (with the customer, the trailer count, the deal context). Tom explicitly praised this as *"a great tool."* This already partly works for meetings when you invite others — needs to work for call reminders and follow-ups too.
- **"Next action" prompt after quote generation** — Dave's flow: *"Right, I'm gonna send this guy a quote… what do you wanna do next? … Right, I'm gonna call him in a week's time."* The next-action selector should offer date, action type (call, email, meeting), and populate both the tracker and the calendar.

**Changes to existing features:**
- Meeting entries should be visually distinguishable — Alex noted *"bold scheduled meeting or bold scheduled call"* — so call reminders and meetings look different on the calendar surface.

**Bugs / complaints raised:**
- None specific to Calendar.

**Data / reporting additions:**
- None specific.

**Dependencies / integrations that affect this page:**
- **ITG for Outlook** — Alex has never wired an Outlook integration and needs ITG's help. Tom is confident *"there's a perfect synchronization between all of it."*
- Notifications system (currently not wired) will drive the pop-up/alert surface (see section 15).

**Open questions / decisions needed:**
- Whether the sync to Outlook is one-way (CRM → Outlook) or bi-directional. Tom said *"the same, or vice versa"* implying bi-directional preferred.

### Priority hint
**Tier 2.** Calendar functionality is largely there; delegation + call reminders + Outlook sync are important but sit behind the Tier-1 CRM/Analytics work.

---

## 7. Company Finder (Lusha)

### Current state (brief)
Working. Pulls straight from Lusha. Uses monthly credits (as previously discussed — payment-for-credits model).

### From the meeting

**New features requested:**
- **Lockout / disable temporarily on rollout** — Tom explicit: *"Maybe just make it unclickable"* until they figure out usage policy. Concern: Dean in particular will play around with searches and burn credits (Tom quoted Gareth-style annoyance *"He's searching!"*). Rendered per-user or globally, TBD.

**Changes to existing features:**
- None specific beyond the lockout.

**Bugs / complaints raised:**
- Search demonstrated in the meeting burned one of the month's credits — visible complaint. Alex noted it's *"dependent on how many times we actually use this thing."*

**Data / reporting additions:**
- Consider a credits-used-this-month indicator so users can see the cost of their behaviour.

**Dependencies / integrations that affect this page:**
- Lusha billing / credit balance API (already integrated).
- Permissions from Admin Panel to control who can and can't use it.

**Open questions / decisions needed:**
- Who unlocks credits and when.
- Is enrichment metered separately from search? Meeting used the phrase *"enrich customer details"* as a distinct operation.

### Priority hint
**Tier 3 (with a Tier 1 gate).** The gate — disabling until policy is set — is trivial to do and must ship with go-live. Enhancements beyond that are low priority.

---

## 8. Insolvency Updates

### Current state (brief)
Gazette feed with type filters.

### From the meeting
No specific items raised in this meeting — page assumed to remain as-is.

### Priority hint
Tier 3 — nothing raised.

---

## 9. Admin panel

### Current state (brief)
Currently being built by Alex. Purpose: individual role management, per-tab visibility permissions.

### From the meeting

**New features requested:**
- **Per-role, per-tab access controls** — Alex explicit: *"creating an admin panel, so I can set individual roles, tabs that people can see."*
- **Restricted-update roles** — e.g. Rama to be added to the team and given a role that lets her update stock (as she currently does the spreadsheet) but not much else. Tom foresees this scaling *"departmentally after a year or two"* once the sales rollout beds in.
- **Handle Sales & Leasing account creation flow** — meeting flagged that Sales & Leasing Protean creates an account when a trailer is sold to a non-credit customer (Rama activates the account to raise the invoice). Admin panel may need a control for who can trigger those flows.

**Changes to existing features:**
- N/A — this page is still under construction.

**Bugs / complaints raised:**
- None; page not yet complete.

**Data / reporting additions:**
- None specific.

**Dependencies / integrations that affect this page:**
- Team roster (who's on the team, added via admin panel).
- Every other page — because they must all respect the permission grants.

**Open questions / decisions needed:**
- Exact taxonomy of roles: at minimum Sales User (Dave/Dean/Tom), Admin (Alex/Tom), Read-only viewer (Gareth), Restricted updater (Rama). Others?
- Whether role changes propagate live or require re-login.

### Priority hint
**Tier 1 (blocker).** The Rama restricted-role case and the read-only Gareth case are both raised as needing to work at go-live.

---

## 10. Settings

### Current state (brief)
User profile, theme.

### From the meeting

**New features requested:**
- **Custom theme option per user** — Alex offered *"I can put some custom themes in for you as well"*; Dave was undecided between light and dark, wanted to keep the choice.

**Changes to existing features:**
- Dark theme judged easier to read than the current light in the demo (both Tom and Dave agreed) — no forced change, but ensure dark is a first-class option.

**Bugs / complaints raised:**
- None.

**Data / reporting additions:**
- None.

**Dependencies / integrations that affect this page:**
- None.

**Open questions / decisions needed:**
- Whether "custom theme" means a picker between named presets or a full colour customiser.

### Priority hint
**Tier 3.** Cosmetic. Alex is doing a broader UI-kit refresh anyway (see cross-cutting).

---

## 11. Brand Kit

### Current state (brief)
Logo storage.

### From the meeting
No specific items raised in this meeting — page assumed to remain as-is.

### Priority hint
Tier 3 — nothing raised.

---

## 12. Social Planner

### Current state (brief)
Post planning with previews. Alex builds graphics and text in advance; posts flow to Tom for approval via a notification (*"you've got X posts to go in and mark approved"*). Alex currently has 60 graphics made and 12 with text ready to show Tom.

### From the meeting

**New features requested:**
- **Approval notification badge for Tom** — already conceived by Alex. Reconfirmed here. Ensure the notifications system wires this specific event.
- **Post-type mix / cadence structure** — content strategy discussion, but has implications for the planner UI. The planner should support and encourage:
  - Tuesday flyer (currently the pattern)
  - Thursday deal-of-the-week mail-shot
  - Sunday post (analytically the busiest day on socials — *"People must just sit about scrolling through LinkedIn"*)
  - Trailer highlight ~twice a week
  - Video content interleaved
  - Personal / staff spotlight posts ("Who are you, what do you do, how long have you been here…")
- **Video post support** — Tom and Dave both flagged video posts get 10× the engagement of static. Planner should treat video as a first-class post type. Video production plan: two days on-site across depots with iPhones capturing content for two months of posts.
- **Fleet Smart Plus contact details on flyers** — change generic email address to Tom's number and Tom's email (`586-472939` in the transcript, Tom's email). This is a content edit but the planner should let Tom edit contact blocks per flyer template.

**Changes to existing features:**
- Preview needs to show the actual contact block that will appear on the post so bugs like the missing-Dave one below are caught.

**Bugs / complaints raised:**
- **Trailer sales flyer missing Dave's name and phone number.** Currently only "your trailer sales manager" is listed, and it's Dean. Tom: *"just leave him and have you both together."* Fix: dual-contact block with Dave and Dean, both on all trailer sales ads. Longer term this may drop to Dave-only; not decided yet.
- Content pipeline behind schedule — Alex has 60 graphics but only 12 with copy. Tom expected them by end of last week. Not a CRM bug; a workload observation.

**Data / reporting additions:**
- Engagement analytics per post already exist (Sunday-is-busiest was drawn from analytics). Ensure post-type comparison (video vs static engagement) is surfaced.

**Dependencies / integrations that affect this page:**
- Notification system (for approval workflow).
- Brand Kit for logos on templates.
- Team roster for staff-spotlight video templates.

**Open questions / decisions needed:**
- RTX hamper QR-code campaign — Tom concluded *"the opposite of better late than never. Just don't do it."* Kill from planner backlog; revisit next year with budget.
- Whether Dean stays on the trailer sales flyer long-term.

### Priority hint
**Tier 2.** Approval flow needs the notifications rewire (Tier 1 cross-cutting) but the planner surface itself is largely functional.

---

## 13. NEW: Fleet Smart Plus builder

### Current state (brief)
**Does not exist inside the CRM yet.** Currently an external tool (an Excel-based / standalone pricing tool). Dean trialled it yesterday. Tom is planning to save it to his desktop and use it in that form for now. The meeting spec was for moving it inside the CRM as part of the Proposal Generator flow (section 14).

### From the meeting

**New features requested (building the whole thing from scratch inside CRM):**
- **Customer details block (top-left)**.
- **Plan selector: Silver / Gold / Platinum** — dropdown that pre-loads baseline labour cost per the selected plan.
- **Contract term selector** — minimum 12 months, default demonstrated 36 months. Longer terms multiply pricing (12-month generic pricing × 3 for 36 months as the baseline).
- **Mileage selector** — default 60,000 miles/year. Higher mileage adds percentages per an internal forecast matrix.
- **5% API (annual price increase) built in** to the multi-year multiplier.
- **Labour rates:** £85/hr truck & van, £65/hr trailer. Trailer rate includes laden RBTs (see below on making that optional).
- **Multi-asset entry** — add as many assets as needed via dropdowns. Reg number entry per asset. Per-asset fields include:
  - Inspection interval (6-weekly / 12-weekly)
  - Laden brake test count per year
  - Days vs nights working pattern
  - (Plus other per-asset toggles — to be specified as the tool matures)
- **Per-asset cost output**, and a total build cost.
- **Notes section flagging missing data** — e.g. *"age hasn't been put in yet."*
- **Contract auto-builds from the pricing data** (Truck Pal replacement — meeting was scathing about Truck Pal: *"Dave's had to shit for five years"*).
- **Add miscellaneous expenses field** — Tom's request. Currently to add extra £500 you have to bump wear-and-tear from £1,500 to £2,000. Tom wants a generic misc-cost line that isn't wear-and-tear. Alex committed to *"give me 10 minutes"* on it in the meeting — status: likely already done.
- **Laden RBT include/exclude tick box** — with count option (4 per year, or 1 per year if MOT-only). Marketing pricing should be based on the 1-per-year (MOT-only) figure so prices look leaner. Reasoning: EVPMS-fitted trailers may not need the four RBTs. Advertise "prices from" and note "LBRTs not included."
- **Pricing unit consistency** — keep everything weekly (or everything monthly, or everything yearly) but do not mix. Dave: *"just go £2 a week, it sounds a lot cheaper."* Trailer marketing prices should be weekly.
- **PMI intervals bug fix** — advertising showed months instead of weeks on PMI intervals (Dave caught it). Ensure unit is weeks throughout PMI configuration.
- **Tires section** — placeholder exists; waiting on tire supplier partnership decision before wiring pricing. Once agreed, matrix pricing from the supplier goes in.
- **Telematics section** — actual cost data available. Partnership with Bronco (same hardware, WebGo software — same as TRF Scale). Cheaper than BPW. STC already has ~30 assets on it. Add as an add-on line to the build with a "did you know" upsell prompt.
- **Manual price override on any line** — Tom's example: *"if you thought it was a bit cheap and you thought, well, I'll stick an extra 200 quid a year in just in case."*
- **Long-term ambition: API into EMS for real parts pricing** — currently parts are requested manually from the depot and typed in. Alex flagged this as *"a bit away from that."*

**Changes to existing features:**
- The tool exists externally; the ask is essentially "move it in and improve it." All items above apply.

**Bugs / complaints raised:**
- Curtis Flynn's version showed months not weeks on PMI intervals.
- All-inclusive pricing looked heavy (~£46/week per trailer at Gold) because it bundled 4 laden RBTs. Fix is the tick-box (above).
- Truck Pal (predecessor) unusable due to tabs not populating; asset copy failing; fields not auto-filling. Fleet Smart Plus must fix all of these.

**Data / reporting additions:**
- Save/export a "proposal" and later a "contract" from the same pricing file — see section 14.

**Dependencies / integrations that affect this page:**
- Tire supplier partner decision.
- Bronco telematics contract confirmation.
- EMS API (long-term).
- Shaggy for parts cost matrix inputs (long-term).

**Open questions / decisions needed:**
- Which tire partner.
- Whether MOT is still exempt on trailers, or whether EVPMS-fitted trailers now require an RBT on MOT (Tom asked, no one was 100% sure, DVSA rules were paraphrased as *"minimum four per year, which can include an MOT"*).
- When the tool actually moves inside the CRM (Tom is happy to keep using it as a standalone file for now — Alex committed to a Teams walkthrough for interested parties like Rama, accounts, possibly Joe).

### Priority hint
**Tier 1.** Tool is actively being trialled by Dean. Miscellaneous-cost line and marketing-pricing tick-box are same-day fixes. Rest is Tier 2 as the tool moves inside the CRM.

---

## 14. NEW: Proposal Generator flows

### Current state (brief)
**Does not exist yet.** This is Tom's central architectural proposition from the meeting — a new set of pages/flows that route out of the CRM contact record.

### From the meeting

**Overall flow (Tom's step-by-step, quoted structurally):**
1. User is inside an existing customer's CRM record (or a prospect's).
2. Somewhere on the customer, a **"Generate Proposal"** action.
3. Prompt: *"What would you like to generate a proposal for? Trailer sales, maintenance, or rental?"*
4. Click routes to one of three sub-flows:
   - **Maintenance → Fleet Smart Plus builder** (section 13). Full pricing tool; produces a proposal and a separate contract.
   - **Rental → Rental Proposal page** (new; described below).
   - **Trailer sales → Trailer Sales Order Form** (new; described below).
5. After proposal acceptance, a **DocuSign shortcut** takes the user to the DocuSign home page to build/send the signable envelope (see CRM section for the DocuSign detail).

**Sub-flow: Rental Proposal**
- One-page proposal Tom described as *"a quick hit one page… stock control sent there."*
- T&Cs are five pages, sent separately (not part of the one-pager).
- Data pulled from Trailer Stock (matching the customer's need) and Sales & Leasing terms.

**Sub-flow: Trailer Sales Order Form**
- Pre-populated from the CRM record.
- Sent for DocuSign signature via the DocuSign shortcut.
- Currently done as a Word document with all customer details re-typed manually — the ask is to eliminate that re-typing.

**Sub-flow: Maintenance Proposal (Fleet Smart Plus)**
- Proposal-vs-Contract separation: *"a proposal and a contract should look a little bit different."*
- Proposal is *"nice and fluffy"* — Stockport Truck Centre, seven depots, marketing intro, pricing summary in the middle, no T&Cs.
- Contract is the full document with T&Cs.
- Idea: reuse the flyer templates from the Social Planner / Brand Kit as the proposal front-matter.
- Workflow: build pricing → save file → generate proposal → send → on acceptance, come back to the same file and generate contract → send via DocuSign.

**Sub-flow: Refurb Quote**
- Not explicitly a distinct proposal type in the meeting, but the refurb matrix (section 3) feeds a per-trailer refurb quote that could sit here. Flag for confirmation.

**Prospect flow (as opposed to existing customer):**
- Prompt after adding prospect: *"what to do next?"* (as noted in CRM section).
- Options should map to the three proposal types so a prospect goes straight into the same flow.
- Split proposal pipelines on the Dashboard between prospect and existing-customer proposals.

**Dependencies / integrations:**
- Fleet Smart Plus builder must exist inside the CRM (section 13) for the maintenance sub-flow to work as spec.
- Trailer Stock (section 3) for the rental one-pager.
- Brand Kit / Social Planner templates for the "fluffy" proposal front page.
- DocuSign shortcut (CRM section, section 1).

**Open questions / decisions needed:**
- Exact layout of the rental one-pager — needs a design pass.
- Whether the "T&Cs sent separately" for rental means auto-send as a follow-up email attachment, or user manually sends them.
- Whether the trailer sales order form is a single template or per-branch variant.
- Whether a Refurb Quote counts as a fourth proposal type or a modifier on Trailer Sales.

### Priority hint
**Tier 1.** This is the workflow Tom described as the reason for having a CRM at all. Everything else is instrumentation around this loop.

---

## 15. Cross-cutting / infrastructure

Not page-specific; must land alongside the per-page work.

### Notifications system
- **Bug / state:** Alex previously had a notification system working; it's not wired in the current build. Multiple downstream features depend on it:
  - Inactive-prospect nudges (Sales Tracker)
  - Diary/call reminders (Calendar)
  - Approval notifications for Tom on social posts (Social Planner)
  - Account revenue spike/drop alerts (Analytics)
  - "You've been assigned a call by another user" (Delegation across Calendar / Tracker)
- Rebuild-and-rewire is a Tier 1 dependency for at least four other pages.

### Outlook integration
- Bi-directional sync: CRM actions flow to Outlook calendar/email and vice versa.
- Alex has not built an Outlook integration before; **needs ITG to guide setup.**
- Tom expects *"a perfect synchronization between all of it."*

### Protean integration (via ITG server)
- Nightly report at midnight, ready by 6–7am. Cadence agreed as *"once every 24 hours out of working hours."*
- Live connection not feasible per Alex.
- Feeds Analytics (revenue, invoice counts), CRM (account-active status), and per-user targets/actuals.
- Sales & Leasing Protean is a separate instance Alex has no access to — needs a person to explain how accounts get created there.
- Overshadowed by the Wayne decision on Transora vs Protean — if Transora is chosen, this whole feed may be re-scoped.

### File ↔ CRM bidirectional sync (transitional)
- For approximately three months post-go-live, the legacy sales tracker file and stock file must stay in sync with the CRM.
- Same ITG server dependency.
- Applies to: Sales Tracker, Trailer Stock, and any other tab currently backed by an Excel file.

### Permissions granularity (Admin Panel)
- All pages must respect per-role, per-tab, per-action grants.
- Priority roles at go-live: Sales User, Admin, Read-only (Gareth), Restricted Updater (Rama).

### Delegated actions across users
- Cross-cuts Calendar, Sales Tracker, and CRM. The pattern is: user A takes an action on customer X while user B (who owns X) is unavailable → user A logs the action into user B's tracker/calendar and it appears as a notification for user B.

### UI kit refresh
- Alex has spent morning-of-meeting building new UI kit: colours, buttons, components.
- Layout is preserved so users don't have to relearn.
- Should land within a week of the meeting.

### AI-style search bar
- Global top-nav search bar accepting natural-language questions over the CRM/Protean data.
- Alex has built one before, so is confident.
- Not tied to a single page.

### In-app messaging / video call
- Alex mentioned he could add message / call / video call functionality across the CRM if not too much effort.
- Not requested urgently — nice-to-have.

### Automated reports
- Weekly Gareth email (see Analytics).
- Any other automated report should live in a general "Reports" area or per-page.

### VPN constraint
- CRM sits behind VPN — this prevents CRM from replacing DocuSign, because generated documents would be file-based (not signable via an external link).

---

## Open commercial decisions (need Dave/Tom/Wayne/Gareth answers before build)

Enumerated from every "we'll have to come back to" moment in the meeting:

1. **Protean vs Transora** — Wayne has not finalised the new operating system. Transora is a candidate (mentioned as *"the one that Buck is moving over to, Trans-something… all the services we use, all the third parties like truckfarm, built in… and CRM side of things"*). Decision affects: whether CRM builds a full Protean feed or thin-shims a Transora feed, and whether entire sections (rental, asset building) get subsumed.
2. **Per-user targets** — how to load, who can see, what granularity (month / year). Sensitive info. Tom: *"We'd have to come back to that."*
3. **Inactive-prospect nudge threshold** — 7 days (Tom) vs 14 days (Dave floated).
4. **Spike/drop alert thresholds** — no numbers agreed.
5. **Tire partner** — blocks Fleet Smart Plus tire pricing integration.
6. **Refurb pricing matrix values** — needs Shaggy sit-down, per trailer type.
7. **Rama's exact permissions** — write to stock only, or broader.
8. **Gareth's simplified Analytics view** — needs Gareth input directly.
9. **Sales & Leasing Protean access** — Alex needs someone with sales-leasing access to explain how accounts get created there so the auto-promotion works.
10. **DocuSign templates** — Tom keeps two (Sales & Leasing DV mandate; STC Group DV mandate) because they're separate business entities per Julie's advice. Confirm this is stable before wiring the shortcut.
11. **Trailer sales flyer contact** — both Dave and Dean for now; longer term possibly Dave-only. Not decided.
12. **Video content production plan** — two-day shoot across depots, iPhones, staff engagement; not scheduled.
13. **RTX hamper QR-code campaign** — killed for this year (*"just don't do it"*); revisit next year with budget.
14. **Next year's RTX budget** — TBD.
15. **How Fleet Smart Plus contact details show** — Tom's email and number replaces generic email; confirm phone number `586-472939` is correct and that it goes on all Fleet Smart flyers.
16. **PMI unit fix in Fleet Smart Plus** — must be weeks not months (fix committed but flag until verified in Curtis Flynn's version).
17. **Laden RBT default in marketing** — Tom's proposed model is 1 MOT-only for marketing prices, tick-box to add the other 3. Confirm before it ships.
18. **Cadence for Teams walkthrough** — Tom wants a session for Rama, accounts, possibly Joe, once Fleet Smart Plus is finalised.
19. **"What to do next" prospect prompt options list** — undefined.
20. **When does the CRM roll out to non-sales departments** — Tom vaguely said *"a year or two"* — no date.

---

## Items I could not confidently categorise into a single page

Flagged for the next Claude to place:

- **"Project planner" / process map for large multi-trailer deals** (e.g. Walker's Transport 10-trailer refurb) — Tom asked if this could be built into the CRM. Currently done in Excel. Alex parked it: *"maybe put a pin in that for now… for now it could just take you to a blank Excel sheet."* Could plausibly live under Trailer Stock (per-deal refurb tracking), Sales Tracker (per-deal project), or as a standalone new page. Unresolved.
- **Capacity / Gantt chart for Renbury refurb capacity** — Tom's aspiration. Could live under Trailer Stock, or as its own operations page, or inside Maintenance Accounts. Explicitly labelled *"ages away"*, but if built, needs a home.
- **In-app messaging / video calling** — Alex offered as add-on; not tied to any page. Would likely be a global overlay component rather than a page.
- **Marketing content strategy discussion (post cadence, video-vs-static)** — much of this is strategy rather than product spec; I placed the product implications under Social Planner but the strategy conversation itself sprawls across marketing operations and doesn't belong to a page per se.
- **Fleet Smart Plus marketing flyer contact edits** — I placed under Social Planner because that's where flyer content is planned, but they're also legitimately Fleet Smart Plus concerns.
- **DocuSign envelope templates (Sales & Leasing vs STC Group DV mandates)** — these are user-owned in DocuSign itself, not stored in the CRM, but the CRM shortcut needs to know they exist. Meta-question of whether the CRM should list/link them.
