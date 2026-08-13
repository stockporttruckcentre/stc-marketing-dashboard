-- =============================================================
-- 004_relationship.sql
--
-- Prospect or existing customer, as a fact on the record.
--
-- Tom asked for proposals to prospective customers and proposals to
-- existing customers to be shown separately. `status` cannot answer
-- that: it says where a deal is, not whether the company was already
-- trading with STC when the proposal went out. A won deal against a
-- fifteen year customer and a won deal against a firm nobody had spoken
-- to in January are the same status and completely different news.
--
-- Separate from status on purpose, and it does not move on its own. When
-- Protean is wired in, an account going active there is what promotes a
-- prospect, and that is the only automatic write this column should ever
-- get.
--
-- Additive and safe to re-run. The CRM treats a missing column as
-- "everybody is a prospect" and says so, so this improves the tab
-- rather than being a prerequisite for it.
-- =============================================================

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS relationship TEXT
  NOT NULL DEFAULT 'prospect'
  CHECK (relationship IN ('prospect', 'existing'));

CREATE INDEX IF NOT EXISTS idx_crm_contacts_relationship
  ON crm_contacts (relationship);

-- The one honest signal available before Protean: a record already at
-- customer or won was trading. Everything else starts as a prospect,
-- which is the safer wrong answer of the two, because calling a real
-- customer a prospect is embarrassing in a meeting and calling a
-- prospect a customer is embarrassing in a proposal.
UPDATE crm_contacts
SET relationship = 'existing'
WHERE status IN ('customer', 'won');
