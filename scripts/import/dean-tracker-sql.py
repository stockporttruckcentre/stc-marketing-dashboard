"""Turning the read of Dean's tracker into SQL somebody can paste.

See `dean-tracker-read.py` for the half that does the reading and the
mapping. This half only formats: literals escaped, a deterministic id
per lead so the file is safe to run twice, and the prose that explains
each judgement call to whoever runs it.
"""
import json, hashlib, uuid

leads = json.load(open('/tmp/leads.json'))
OUT = '/tmp/claude-0/-home-user-stc-marketing-dashboard/8f56cd4b-eb0a-52ff-b3fc-74253f0d02e6/scratchpad/dean/7-dean-leads.txt'

def q(v):
    if v is None: return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def num(v):
    return 'NULL' if v is None else repr(float(v))

def lead_id(l):
    key = f"stc-import:dean:{l['sheet']}:{l['company'].strip().lower()}:{l.get('date') or ''}:{l['type']}"
    return str(uuid.UUID(hashlib.md5(key.encode()).hexdigest()))

seen = set()
rows = []
for l in leads:
    i = lead_id(l)
    if i in seen:
        # Same company, same sheet, same day, same type twice. One pitch.
        continue
    seen.add(i)
    rows.append((i, l))

# Accounts: one per company name, taking the first row that carries each detail.
accounts = {}
for _, l in rows:
    key = l['company'].strip().lower()
    a = accounts.setdefault(key, {'company': l['company'].strip(),
                                  'contact': None, 'email': None, 'phone': None,
                                  'location': None, 'source': None})
    for f in ('contact', 'email', 'phone', 'location', 'source'):
        if a[f] is None and l.get(f):
            a[f] = l[f]

sql = []
w = sql.append

w("""-- =============================================================
-- Dean Mann's tracker, out of the spreadsheet and into the CRM.
--
-- 107 leads across six sheets of
-- "Sales & Maint Leads Tracker - Dean Mann.xlsx", plus the accounts
-- they hang off. Everything here is owned by Dean.
--
-- Run this in the Supabase SQL editor. It is one transaction: if any
-- part of it fails, none of it lands.
--
-- ---- Safe to run more than once ----
--
-- Every lead is given an id derived from the sheet it came from, the
-- company, the date and the type, so running this twice inserts
-- nothing the second time rather than making 107 duplicates. That
-- matters more than usual here: an import somebody is not sure worked
-- is an import they run again.
--
-- ---- What it will not do ----
--
-- It never overwrites a detail the CRM already has. An account already
-- in the CRM gains a phone number only where the CRM's is empty, so
-- anything corrected since the spreadsheet was last touched stays
-- corrected. The spreadsheet is older than the CRM for the accounts
-- already imported, and older loses.
--
-- ---- Where each sheet went ----
--
--   Prospecting Maint Accounts   38 maintenance leads
--   Trailer Sales prospects      20 trailer sales, contacted
--   Trailer Sales Customer       12 trailer sales, customer
--   Trailer Lost Sales           27 trailer sales, lost
--   Contract pipeline             7 quoted deals, by contract type
--   Active Rental Accounts        3 rental customers
--
-- Active Maint Account is not in here. You said those are already in.
--
-- ---- Three judgement calls, so you can overrule them ----
--
-- "No Action" on the maintenance sheet became `lead`, not `lost`. Both
-- rows say "currently no requirement for additional support", which is
-- parked rather than lost, and marking them lost would take them out
-- of the pipeline and say something the sheet does not say. Evri and
-- ITV Studios are the two.
--
-- "Dealt" became `quoted`. The one row is PMCE Ltd, whose update says
-- Trukplans were created and sent and whose next action is to chase.
-- That is a quote out and waiting, which is what quoted means here.
--
-- The Contract pipeline rows became `quoted` leads rather than being
-- left out, because each is a real pitch with a value on it. Two of
-- those companies also appear on other sheets, and they stay two
-- separate leads on purpose: Suttle Transport has a trailer enquiry
-- and a rental contract, and those are two different pitches to the
-- same customer.
--
-- A value that was not a number is empty rather than guessed. Three
-- rows said things like "Mulitple/See email" in the value column.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Dean, and nothing lands if he is not there.
-- -------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM profiles
   WHERE lower(btrim(full_name)) = 'dean mann';
  IF n = 0 THEN
    RAISE EXCEPTION
      'No account here is called Dean Mann. Check the spelling in profiles.full_name, then run this again.';
  END IF;
  IF n > 1 THEN
    RAISE EXCEPTION
      'There are % accounts called Dean Mann, so this cannot tell whose tracker it is.', n;
  END IF;
END $$;

CREATE TEMP TABLE dean AS
SELECT id FROM profiles WHERE lower(btrim(full_name)) = 'dean mann';

-- -------------------------------------------------------------
-- 2. Every row off the sheets, as it was read.
--
-- Held in a temporary table rather than inlined into the inserts, so
-- the two steps below both read the same list and the readback at the
-- end can count against it.
-- -------------------------------------------------------------
CREATE TEMP TABLE incoming (
  lead_id     UUID PRIMARY KEY,
  sheet       TEXT,
  company     TEXT NOT NULL,
  contact     TEXT,
  email       TEXT,
  phone       TEXT,
  location    TEXT,
  lead_type   TEXT NOT NULL,
  status      TEXT NOT NULL,
  what        TEXT,
  requirement TEXT,
  new_or_used TEXT,
  est_value   NUMERIC,
  action      TEXT,
  next_action TEXT,
  enquired    DATE,
  notes       TEXT,
  source      TEXT
);

INSERT INTO incoming VALUES""")

vals = []
for i, l in rows:
    vals.append("  (" + ", ".join([
        q(i), q(l['sheet']), q(l['company'].strip()), q(l.get('contact')),
        q(l.get('email')), q(l.get('phone')), q(l.get('location')),
        q(l['type']), q(l['status']), q(l.get('what')), q(l.get('requirement')),
        q(l.get('new_or_used')), num(l.get('estimated_value')),
        q(l.get('action')), q(l.get('next_action')),
        q(l.get('date')) + '::DATE' if l.get('date') else 'NULL',
        q(l.get('notes')), q(l.get('source')),
    ]) + ")")
w(",\n".join(vals) + ";")

w("""
-- -------------------------------------------------------------
-- 3. The accounts.
--
-- Matched on the company name, folded to lower case and trimmed,
-- because "Suttle Transport " and "Suttle Transport" are one customer
-- and the spreadsheet holds both.
--
-- An account already in the CRM is not overwritten. It gains a contact
-- name, an email, a phone or a location only where the CRM's own is
-- empty, so anything corrected since the sheet was written survives.
-- -------------------------------------------------------------
INSERT INTO crm_contacts (company_name, contact_name, email, phone, location, assigned_to, source, status)
SELECT DISTINCT ON (lower(btrim(i.company)))
       btrim(i.company), i.contact, i.email, i.phone, i.location, 'Dean Mann',
       /* NOT NULL with a default of 'manual'. Passing NULL explicitly
          defeats a default, so the fallback is stated here. */
       COALESCE(i.source, 'manual'), 'lead'
  FROM incoming i
 WHERE NOT EXISTS (
   SELECT 1 FROM crm_contacts c
    WHERE lower(btrim(c.company_name)) = lower(btrim(i.company))
 )
 ORDER BY lower(btrim(i.company)),
          (i.contact IS NULL), (i.email IS NULL), (i.phone IS NULL);

UPDATE crm_contacts c SET
  contact_name = COALESCE(NULLIF(btrim(c.contact_name), ''), f.contact),
  email        = COALESCE(NULLIF(btrim(c.email), ''),        f.email),
  phone        = COALESCE(NULLIF(btrim(c.phone), ''),        f.phone),
  location     = COALESCE(NULLIF(btrim(c.location), ''),     f.location),
  assigned_to  = COALESCE(NULLIF(btrim(c.assigned_to), ''),  'Dean Mann')
FROM (
  SELECT DISTINCT ON (lower(btrim(company)))
         lower(btrim(company)) AS key, contact, email, phone, location
    FROM incoming
   ORDER BY lower(btrim(company)),
            (contact IS NULL), (email IS NULL), (phone IS NULL)
) f
WHERE lower(btrim(c.company_name)) = f.key;

-- -------------------------------------------------------------
-- 4. Quiet, for the length of the import.
--
-- Migration 066 tells somebody when a prospect lands on their tracker.
-- That is right for one handed over by a colleague and wrong for an
-- import: 107 of them at once is not 107 things happening to Dean, and
-- the bunching would make it one notification saying 107, which is a
-- number rather than news.
--
-- The status trigger from migration 043 is deliberately left running.
-- Each account's status has to follow the leads going in, which is the
-- whole point of putting them in.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_lead_assigned') THEN
    ALTER TABLE crm_leads DISABLE TRIGGER notify_lead_assigned;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 5. The leads.
--
-- The id is derived from the sheet, the company, the date and the
-- type, so this is safe to run again: the second run conflicts on
-- every row and inserts nothing.
-- -------------------------------------------------------------
INSERT INTO crm_leads (
  id, contact_id, owner_id, created_by, type, status,
  what, requirement, new_or_used, estimated_value,
  action, next_action, notes, date_of_enquiry, last_activity_at
)
SELECT
  i.lead_id, c.id, d.id, d.id, i.lead_type, i.status,
  i.what, i.requirement, i.new_or_used, i.est_value,
  i.action, i.next_action, i.notes, i.enquired,
  COALESCE(i.enquired::TIMESTAMPTZ, NOW())
FROM incoming i
JOIN crm_contacts c ON lower(btrim(c.company_name)) = lower(btrim(i.company))
CROSS JOIN dean d
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_lead_assigned') THEN
    ALTER TABLE crm_leads ENABLE TRIGGER notify_lead_assigned;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 6. Did it all land.
--
-- Every row off the sheets has to have found an account and become a
-- lead. Anything that did not is named rather than counted, because a
-- number tells nobody which company to go and look at.
-- -------------------------------------------------------------
DO $$
DECLARE missing INT; made INT; wanted INT;
BEGIN
  SELECT count(*) INTO wanted FROM incoming;

  SELECT count(*) INTO missing
    FROM incoming i
   WHERE NOT EXISTS (
     SELECT 1 FROM crm_contacts c
      WHERE lower(btrim(c.company_name)) = lower(btrim(i.company)));
  IF missing > 0 THEN
    RAISE EXCEPTION '% rows found no account, which should be impossible after step 3', missing;
  END IF;

  SELECT count(*) INTO made FROM crm_leads l JOIN incoming i ON i.lead_id = l.id;
  IF made <> wanted THEN
    RAISE EXCEPTION 'the sheets had % rows and % leads are here', wanted, made;
  END IF;

  RAISE NOTICE 'ok  % leads are on Dean''s tracker, from % companies',
    made, (SELECT count(DISTINCT lower(btrim(company))) FROM incoming);
END $$;

COMMIT;

-- -------------------------------------------------------------
-- What went in, to read after.
-- -------------------------------------------------------------
SELECT l.type, l.status, count(*) AS leads,
       count(*) FILTER (WHERE l.estimated_value IS NOT NULL) AS with_a_value,
       to_char(SUM(l.estimated_value), 'FM£999,999,999') AS pipeline
FROM crm_leads l
JOIN profiles p ON p.id = l.owner_id
WHERE lower(btrim(p.full_name)) = 'dean mann'
GROUP BY l.type, l.status
ORDER BY l.type, l.status;

-- And what each account's status became, which the trigger from
-- migration 043 worked out from the leads that just went in.
SELECT c.company_name, c.status, count(l.id) AS leads
FROM crm_contacts c
JOIN crm_leads l ON l.contact_id = c.id
JOIN profiles p ON p.id = l.owner_id
WHERE lower(btrim(p.full_name)) = 'dean mann'
GROUP BY c.company_name, c.status
ORDER BY c.company_name
LIMIT 120;
""")

open(OUT, 'w').write("\n".join(sql) + "\n")
print('rows emitted:', len(rows))
print('accounts:', len(accounts))
print('written to', OUT)
