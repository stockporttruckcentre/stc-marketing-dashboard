import type { ContractInput } from './types';
import { blankExtras, type ContractExtras } from './contract';

/* =============================================================
   Copying a contract.

   ---- The bug this exists because of ----

   Copy seeded the wizard with the contract's `input` and `extras` and
   passed `row: null`. The wizard reads the ACCOUNT and the LEAD off
   `row`, so a copy arrived with the customer's name showing on the
   Customer step, out of `input`, and no account behind it.

   Saving then wrote a contract with a null `account_id`. The trigger in
   migration 067 raised a lead with a null `contact_id`, and the tracker
   showed it as an unknown company with nothing on it. From the
   business: "when it creates a tracker lead for the Copy contract, it
   doesn't populate any details in the tracker and says unknown
   customer."

   Showing somebody's name on step one while linking nothing is the
   inconsistency. The customer is one of the details being duplicated.

   ---- The lead is the opposite case ----

   It stays null, deliberately. A copy is a SECOND contract. Pointing it
   at the first one's lead would make the trigger take the "somebody
   attached it to a pitch they had already opened" branch: two prices
   against one lead, and the first contract's status quietly overwritten
   by the second's.
   ============================================================= */

/** As much of a contract as copying it needs. */
export type Copyable = {
  account_id: string | null;
  lead_id: string | null;
  input: ContractInput;
  extras: ContractExtras | null;
};

export type CopySeed = {
  input: ContractInput;
  extras: ContractExtras;
  accountId: string | null;
  /** Always null. See the header. */
  leadId: null;
};

export function seedFromContract(row: Copyable): CopySeed {
  return {
    /* The asset keys are renumbered rather than reused. They are React
       keys as well as row identities, and two rows carrying the same
       key in one list is a rendering bug that shows up as a row that
       will not edit. */
    input: { ...row.input, assets: row.input.assets.map((a, i) => ({ ...a, key: `a${i}` })) },
    extras: { ...blankExtras(), ...(row.extras ?? {}) },
    accountId: row.account_id,
    leadId: null,
  };
}
