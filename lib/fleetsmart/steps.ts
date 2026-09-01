import type { ContractInput } from './types';
import type { ContractExtras } from './contract';

/* =============================================================
   The six steps of the builder, and when each one is finished.

   The wizard used to let anybody click straight to Review on an empty
   form. Every step was reachable from the first second, so the rail was
   a set of tabs rather than a route through the work, and the commonest
   way to get a bad contract was to skip the step that would have caught
   it.

   From the business:

     You shouldn't be able to click the other tabs until the one before
     it has been completed so you're forced to do it in order and see the
     animated message each time.

   ---- What "completed" means, per step ----

   Deliberately the minimum that makes the next step answerable, not
   everything the step can hold. A gate that asks for more than the next
   decision needs is a gate people learn to resent.

   Customer   a name. Everything else on that step is optional and most
              of it fills itself from the CRM.
   Plan       a plan, a term and a start date. All three have defaults,
              so this passes the moment somebody looks at it, which is
              right: the step exists to be seen and agreed, not to be
              filled in.
   Fleet      one asset with a reg and a type. This is the real gate.
   Money      always finished. The discounts are optional and a contract
              with neither is the common case.
   Wording    always finished. Every block writes itself.
   Review     the end.

   ---- Why the rules live here ----

   The rail reads them to decide what to unlock, the Next button reads
   them to decide whether it is enabled, and the coach reads them to
   decide what to say is missing. Three readers, one definition.
   ============================================================= */

export const STEPS = ['Customer', 'Plan', 'Fleet', 'Money', 'Wording', 'Review'] as const;
export type Step = (typeof STEPS)[number];

/** The message the coach shows on arriving at each step. */
export const STEP_COACH: Record<Step, { title: string; body: string }> = {
  Customer: {
    title: 'Select your customer and enter their details',
    body: 'Search the CRM. Picking an account fills the name, the contact and the address, and ties the contract to their record so it shows on the tracker.',
  },
  Plan: {
    title: 'Now choose the plan they are on',
    body: 'Silver, Gold or Platinum, how long the contract runs and when it starts. The labour rates are here too, and they are what collection and delivery is priced at.',
  },
  Fleet: {
    title: 'Add their fleet, one row per asset',
    body: 'A registration and an asset type is enough. Every other column fills itself from the plan and the class, and anything you type over the top wins.',
  },
  Money: {
    title: 'Check the price, and take anything off it',
    body: 'Every line that makes up the figure is here, per asset. The manager and promotional discounts are optional and most contracts carry neither.',
  },
  Wording: {
    title: 'Read the wording it will print',
    body: 'Eight blocks, each written from the fleet you just entered, so the contract can never claim something the customer is not being charged for. Override any block that needs it.',
  },
  Review: {
    title: 'This is what the customer gets',
    body: 'The contract exactly as it will print. Save it as a draft, or save and send it.',
  },
};

/** Whether a step has been done, well enough to move past it. */
export function stepDone(step: Step, input: ContractInput, _extras: ContractExtras): boolean {
  switch (step) {
    case 'Customer':
      return input.customerName.trim() !== '';
    case 'Plan':
      return Boolean(input.plan) && input.termMonths > 0 && input.startDate.trim() !== '';
    case 'Fleet':
      return input.assets.some((a) => a.reg.trim() !== '' && a.type !== '');
    case 'Money':
    case 'Wording':
    case 'Review':
      return true;
  }
}

/**
 * What is stopping this step being finished, in the words somebody can
 * act on. Null once it is.
 */
export function whatIsMissing(step: Step, input: ContractInput): string | null {
  switch (step) {
    case 'Customer':
      return input.customerName.trim() === ''
        ? 'Pick a customer from the CRM, or type a name.' : null;
    case 'Plan':
      return input.startDate.trim() === '' ? 'Give the contract a start date.' : null;
    case 'Fleet':
      if (input.assets.some((a) => a.reg.trim() !== '' && a.type !== '')) return null;
      return input.assets.some((a) => a.reg.trim() !== '')
        ? 'Choose an asset type for the row you have started.'
        : 'Add one asset: a registration and an asset type.';
    default:
      return null;
  }
}

/**
 * The furthest step somebody may open, which is one past the last one
 * they finished.
 *
 * Not "every step whose own rule passes": a later step can pass its own
 * rule while an earlier one does not, and unlocking it on that basis
 * would let somebody reach Review with no customer on the contract.
 */
export function furthestOpen(input: ContractInput, extras: ContractExtras): number {
  let i = 0;
  while (i < STEPS.length - 1 && stepDone(STEPS[i], input, extras)) i += 1;
  return i;
}

/**
 * Whether a step is reachable right now.
 *
 * Always true for a step behind where somebody has already got to, so
 * going back to change the fleet and forward again does not mean
 * clicking Next four times.
 */
export function canOpen(step: Step, input: ContractInput, extras: ContractExtras, reached: number): boolean {
  const i = STEPS.indexOf(step);
  return i <= Math.max(reached, furthestOpen(input, extras));
}
