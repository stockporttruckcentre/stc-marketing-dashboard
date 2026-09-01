/* =============================================================
   The words on a FleetSmart+ contract.

   The workbook's Contract Wording tab, ported. Each block writes itself
   from the plan and the fleet, and each one can be overtyped for a
   customer without touching the others: `wordingFor` returns the
   automatic text, and anything in `overrides` wins.

   ---- Why the text is computed rather than fixed ----

   Because a contract that promises what the customer is not paying for
   is the expensive kind of wrong. The Services block is assembled from
   the flags the engine returns, and those flags come off what was
   actually charged, so a Platinum contract made entirely of trailers
   does not offer bulbs and a fleet with no tail lifts does not offer
   tail lift servicing.

   ---- The static terms ----

   Everything from "Basis of contract" down is STC's standard terms and
   never changes with the fleet, so it lives in `TERMS` as flat text. It
   is printed after the sign-off, exactly as the workbook prints it.
   ============================================================= */
import type { ContractInput, PricedContract } from './types';
import { intervalFor } from './price';
import { DEFAULT_LABOUR } from './ratecard';

/** Who STC is, on paper. */
export const STC = {
  legalName: 'STOCKPORT TRUCK CENTRE LIMITED',
  companyNumber: '03967781',
  registeredOffice: 'Old Moor Road, Bredbury, Stockport, Cheshire SK6 2QE',
  vatNumber: '757 5061 16',
  noticeEmail: 'info@stc-uk.com',
};

export type WordingKey =
  | 'planTitle' | 'term' | 'services' | 'exclusions'
  | 'additional' | 'charges' | 'collection' | 'payment';

export const WORDING_LABEL: Record<WordingKey, string> = {
  planTitle: 'Plan title',
  term: 'Term',
  services: 'Services included',
  exclusions: 'Exclusions',
  additional: 'Additional services',
  charges: 'Charges',
  collection: 'Collection and delivery',
  payment: 'Payment',
};

/** Everything about the document that is not the fleet or the price. */
export type ContractExtras = {
  companyNumber: string;
  registeredAddress: string;
  /* The customer's own email and number, filled from the CRM when an
     account is picked. The email is what the Send box opens on, so
     sending a contract to a customer already in the CRM is one press
     rather than a trip back to the record to copy an address. */
  customerEmail: string;
  customerPhone: string;
  maximumMileage: number | null;
  accountManagerName: string;
  accountManagerPhone: string;
  accountManagerEmail: string;
  /** One per block. An empty string means "use the automatic text". */
  overrides: Partial<Record<WordingKey, string>>;
};

export function blankExtras(): ContractExtras {
  return {
    companyNumber: '',
    registeredAddress: '',
    customerEmail: '',
    customerPhone: '',
    /* The workbook's wear and tear baseline, on the Lists tab, and the
       figure most of these contracts are written at. It was 100,000
       here, which meant every contract needed the number changing. */
    maximumMileage: 60_000,
    accountManagerName: '',
    accountManagerPhone: '',
    accountManagerEmail: '',
    overrides: {},
  };
}

/**
 * A contract with nothing on it yet.
 *
 * Platinum, thirty six months and the standard labour rates, because
 * that is what the overwhelming majority of these are and a blank form
 * that starts on the common answer is a form with three fewer clicks in
 * it. Everything here is typed over on the way through.
 */
export function blankContract(): ContractInput {
  return {
    plan: 'Platinum',
    termMonths: 36,
    startDate: '',
    customerName: '',
    customerAddress: '',
    customerContact: '',
    customerCompanyNumber: '',
    labourHgv: DEFAULT_LABOUR.hgv,
    labourTrailer: DEFAULT_LABOUR.trailer,
    labourVan: DEFAULT_LABOUR.van,
    managerDiscount: 0,
    promoDiscount: 0,
    promoOnContract: false,
    assets: [],
  };
}

const money = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- the blocks that write themselves ---- */

function planTitle(input: ContractInput): string {
  return input.plan === 'Platinum'
    ? 'FleetSmart+ Platinum, Full Fixed Price Maintenance Plan'
    : input.plan === 'Gold'
      ? 'FleetSmart+ Gold, MOT, Documentation and Servicing Plan'
      : 'FleetSmart+ Silver, MOT and Documentation Plan';
}

const TERM_TEXT =
  'The Term will commence on the Contract Commencement Date and will continue, unless '
  + 'terminated earlier in accordance with clause 8, for an initial period of one year (the '
  + 'Initial Period). At the end of the Initial Period (and any Extended Period), the Term will '
  + 'automatically renew for a further twelve (12) month period unless a party notifies the '
  + 'other in writing at least three (3) months before expiry that it does not wish to extend. '
  + 'If extended, all terms and conditions remain the same except as the parties may agree in '
  + 'writing.';

const EXCLUSIONS_TEXT =
  'The Maintenance Services do not include parts and labour for any repairs and replacement '
  + 'items not listed above, tyres, fridge / tail lift components / maintenance, damage or '
  + 'misuse, corrosion, paint and legislation changes, or any scheduling of necessary repairs '
  + 'and/or inspections, which shall be the sole responsibility of the Customer unless '
  + 'otherwise agreed by STC in writing. The Maintenance Services do not include the service or '
  + 'replacement of the Diesel Particulate Filter (DPF).';

const ADDITIONAL_TEXT =
  'Additional Services include any works carried out by STC which are not within the scope of '
  + 'the Services, and any Excluded Services performed by STC under this agreement. Additional '
  + "Services are charged on a time and materials basis in accordance with STC's price list in "
  + "force at the date of the Additional Services, or STC's agreed price list with the Customer.";

const PAYMENT_TEXT =
  'STC shall invoice the Customer monthly in advance for the Services. The Customer has five '
  + '(5) Business Days to dispute an invoice; otherwise it is deemed approved and collected by '
  + 'Direct Debit. All payments are collected by Direct Debit on the 1st day of the month '
  + 'following the issue of an invoice (or the nearest Business Day). If payment is not made by '
  + 'Direct Debit on the due date, the Customer shall arrange immediate payment by alternative '
  + 'means.';

/**
 * What the plan and the fleet between them actually cover.
 *
 * One line per thing, and every line is behind a flag the engine set
 * from what was charged. This is the block the whole flag mechanism
 * exists for.
 */
function services(input: ContractInput, priced: PricedContract): string {
  const f = priced.flags;
  if (!input.assets.some((a) => a.reg.trim())) {
    return 'Add the assets on the fleet step. This list fills itself from the plan and the fleet.';
  }

  const out: string[] = [
    input.plan === 'Silver'
      ? 'Annual DVSA safety inspection carried out at MOT'
      : 'All safety inspections to exceed DVSA standards',
    `Pre-MOT inspection, MOT steam clean, MOT fees, weight hire and presenting ${f.assetWords} for test`,
  ];

  if (f.brakeTests && f.ladenRbts) out.push('Brake tests and laden roller brake tests');
  else if (f.ladenRbts) out.push('Laden roller brake tests');
  else if (f.brakeTests) out.push('Brake tests');

  if (f.tacho) out.push('Tachograph calibrations');
  if (input.plan !== 'Silver') {
    out.push(`Scheduled servicing to manufacturer standards (${f.cService ? 'A and C service' : 'A service'})`);
  }
  if (f.serviceParts) {
    out.push(input.plan === 'Platinum'
      ? 'Service parts, oils, filters, lubricants, bulbs and consumables'
      : 'Service parts, oils, lubricants, bulbs and consumables');
  }
  if (input.plan === 'Platinum') {
    out.push('In-depth mechanical component servicing including brakes and suspension');
  }
  if (f.wearAndTear) out.push('Wear and tear component cover reflecting age and usage');
  if (f.tailLift) out.push('Tail lift LOLER, weight test and servicing');
  if (f.telematics) out.push('Telematics brake performance monitoring');
  if (f.collectionAndDelivery) out.push('Collection and delivery for the assets marked C&D in the Schedule');
  if (f.portal) out.push('Compliance portal access');
  if (f.documentStorage) out.push('Document storage and defect scheduling');

  return out.join('\n');
}

function charges(input: ContractInput, priced: PricedContract): string {
  let s = `The Charges payable for the Maintenance Services shall be £${money(priced.monthly)} per `
    + `month (as detailed above). The labour rate at the date of this agreement for non-contract `
    + `repairs is £${money(input.labourHgv)} per hour. All sums are exclusive of VAT.`;

  if (priced.flags.misc) {
    s += ' The Charges include the agreed miscellaneous items shown against the relevant assets in the Schedule.';
  }
  if (priced.flags.telematics) {
    s += ' The Charges include telematics brake performance monitoring for the assets shown in the Schedule.';
  }
  if (priced.flags.hasTrailers) {
    s += ' Trailers include one laden roller brake test per year, taken at MOT; any additional laden '
      + 'roller brake tests are charged as shown in the Schedule.';
  }
  if (input.promoOnContract && priced.promoDiscount !== 0) {
    s += ` The Charges are stated after a promotional discount of £${money(-priced.promoDiscount / 12)} per month.`;
  }
  return s;
}

function collection(priced: PricedContract): string {
  return priced.flags.collectionAndDelivery
    ? 'Collection and delivery is included in the monthly Charges for the assets marked C&D in the '
      + "Schedule. For all other assets it is charged in accordance with STC's price list in force at the time."
    : 'Charges for collection / delivery of any Vehicle(s) are calculated in accordance with '
      + "STC's price list in force at the time.";
}

/** The automatic text for one block, before any override. */
export function autoWording(key: WordingKey, input: ContractInput, priced: PricedContract): string {
  switch (key) {
    case 'planTitle':  return planTitle(input);
    case 'term':       return TERM_TEXT;
    case 'services':   return services(input, priced);
    case 'exclusions': return EXCLUSIONS_TEXT;
    case 'additional': return ADDITIONAL_TEXT;
    case 'charges':    return charges(input, priced);
    case 'collection': return collection(priced);
    case 'payment':    return PAYMENT_TEXT;
  }
}

/** The text that actually prints: the override where there is one. */
export function wordingFor(
  key: WordingKey, input: ContractInput, priced: PricedContract, extras: ContractExtras,
): string {
  const own = extras.overrides[key];
  return own && own.trim() ? own : autoWording(key, input, priced);
}

/** How often each class is inspected, in the sentence the contract prints. */
export function inspectionSentence(input: ContractInput): string {
  const bits: string[] = [];
  for (const [cls, word] of [['Vehicle', 'Vehicles'], ['Trailer', 'Trailers'], ['Van', 'Vans']] as const) {
    const v = intervalFor(input, cls);
    if (v == null) continue;
    bits.push(v === 'mixed'
      ? `${word.slice(0, -1)} inspection intervals are as set out in the schedule above.`
      : `${word} every ${v} weeks.`);
  }
  return bits.length ? bits.join(' ') : 'Inspection intervals are as set out in the schedule above.';
}

/** The end date, which is the day before the term runs out. */
export function endDate(startDate: string, months: number): string {
  if (!startDate) return '';
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* =============================================================
   STC's standard terms.

   Static. They do not change with the plan, the fleet or the price, so
   they are text rather than anything cleverer, and they are printed
   after the sign-off exactly as the workbook prints them.
   ============================================================= */
export const TERMS_HEADING = 'STC, terms and conditions for maintenance and repair';

export const TERMS_PREAMBLE = [
  'PLEASE READ THESE TERMS CAREFULLY BEFORE SUBMITTING YOUR ORDER TO US.',
  "THE CUSTOMER'S ATTENTION IS DRAWN IN PARTICULAR TO THE PROVISIONS OF CLAUSE 7.",
];

export const TERMS: { number: string; heading: string; clauses: string[] }[] = [
  {
    number: '1', heading: 'Basis of contract',
    clauses: [
      '1.1 These terms apply to the agreement to the exclusion of any other terms that the Customer seeks to impose or incorporate, or which are implied by law, trade custom, practice or course of dealing.',
      '1.2 Notwithstanding that STC may, from time to time, issue estimates or quotations, the agreement shall only be deemed to be accepted when STC has signed the Contract Details sheet, at which point, provided that the Customer has also signed the Contract Details, the agreement shall come into existence. Any quotations or estimates provided are for information only and shall only be binding to the extent specified in the Contract Details section above.',
    ],
  },
  {
    number: '2', heading: 'Supply of Services',
    clauses: [
      '2.1 STC shall supply the Services specified in the Contract Details from the Contract Commencement Date and, where applicable, for the duration of the Term in accordance with the agreement.',
      '2.2 In supplying the Services, STC shall: (a) perform the Services with reasonable care and skill; (b) comply with all applicable laws, statutes, regulations and mandatory codes from time to time in force; (c) use reasonable endeavours to meet any performance dates agreed between the parties, but the Customer acknowledges and agrees that any such dates shall be estimates only and time shall not be of the essence for performance of the Services; (d) use all reasonable endeavours to respond promptly during Business Hours, by telephone or in writing, to any reasonable request from the Customer for information concerning the application and use of the Vehicle, or the repair of any defect in or malfunctioning of the Vehicle.',
      '2.3 STC warrants on an ongoing basis that: (a) it shall discharge its obligations under this agreement using personnel of the required skill, experience and qualifications and with all due skill, care and diligence; and (b) any Spare Parts, Consumables and equipment supplied or used in the course of the provision of the Services shall operate materially in accordance with their technical specifications.',
      '2.4 All other warranties, including the terms implied by sections 3, 4 and 5 of the Supply of Goods and Services Act 1982 are, to the fullest extent permitted by law, excluded from this agreement.',
      '2.5 Where the Customer has contracted for the Maintenance Services Plan, if STC discovers that the Vehicle(s) is defective or is malfunctioning or has failed or is not otherwise in Good Working Order during the course of the Maintenance Services, STC will use reasonable endeavours to repair it. If that is not reasonably practicable, STC may arrange for repair off-site with a sub-contractor. Any repairs carried out in accordance with this clause shall be charged to the Customer at an additional cost.',
      '2.6 On the Customer informing STC that the Vehicle(s) is defective or is malfunctioning or has failed or is not otherwise in Good Working Order, STC shall use reasonable endeavours to arrange collection of the Vehicle(s) or attend the Customer’s premises to perform and complete Maintenance Services during Business Hours. If that is not reasonably practicable STC shall arrange for repair off-site with a sub-contractor. Any work carried out in accordance with this clause may be charged to the Customer at an additional cost.',
      '2.7 STC reserves the right to refuse to carry out any Services on any Vehicle(s) which it considers, in its absolute discretion, to be unsafe and / or unroadworthy or would render the Vehicle(s) the same.',
      '2.8 STC is not obliged to perform any Excluded Services.',
      '2.9 In the event that STC provides the Services at the Customer’s premises: (a) STC shall perform the Services at such times as may be agreed in advance between the Customer and STC from time to time; (b) the Customer shall provide STC with full and free access to its premises to perform the Services; and (c) the Customer shall take all steps necessary to ensure the safety of any of STC’s representatives when attending its premises.',
    ],
  },
  {
    number: '3', heading: 'Maintenance Services Plan: inspection of the Vehicle(s)',
    clauses: [
      '3.1 Where the Customer has contracted for the Maintenance Services Plan, before providing any Services under that plan, STC may elect to carry out an inspection of the Vehicle(s) to determine whether it is in Good Working Order.',
      '3.2 If STC finds the Vehicle(s) not to be in Good Working Order, it shall issue a quotation to the Customer for the work and parts required to restore the Vehicle(s) to Good Working Order, which Services shall not, for the avoidance of doubt, be considered Maintenance Services for the purposes of these Conditions.',
      '3.3 If the Customer accepts the quotation referred to above, STC shall carry out the work in accordance with the quotation, to the standard set out in clause 2.3. Upon completion of the work, STC shall submit its invoice for the work which is immediately due and payable.',
      '3.4 If the Customer refuses the quotation, this agreement shall terminate automatically and without notice and without liability to either party, save that STC shall be entitled to retain the Inspection Fee.',
    ],
  },
  {
    number: '4', heading: 'Spare parts and consumables',
    clauses: [
      "4.1 Where the Customer has contracted for the Maintenance Services Plan, STC shall supply and fit (at the Customer's cost unless specified in the Contract Details) such Spare Parts and Consumables as required to maintain the Vehicle(s) in Good Working Order or to restore the Vehicle(s) to Good Working Order.",
      '4.2 All Spare Parts shall be either new, reconditioned or reassembled Spare Parts which are equivalent to new Spare Parts in performance. All Consumables shall be new. STC will transfer to the Customer, with full title guarantee and free from all third party rights, all the Spare Parts and Consumables that it provides to the Customer, and the Spare Parts and Consumables shall become part of the Vehicle(s) upon their installation in the Vehicle.',
    ],
  },
  {
    number: '5', heading: "Customer's obligations",
    clauses: [
      '5.1 The Customer warrants that it owns the Vehicle(s) or is duly authorised by the owner to enter into this agreement for the Services to be carried out.',
      '5.2 The Customer shall: (a) remove from the Vehicle(s) any items of value not related to the Vehicle(s) and acknowledges that STC will have no liability for loss or damage to such items; (b) co-operate with STC in all matters relating to the Services; and (c) provide, in a timely manner, such information as STC may require, and ensure that it is accurate and complete in all material respects.',
      '5.3 Where the Customer has contracted for the Maintenance Services Plan, the Customer shall at all times during the Term: (a) use the Vehicle(s) only in accordance with the instructions and recommendations of the manufacturer of the Vehicle(s) or as may be reasonably advised in writing from time to time by STC; (b) notify STC promptly if the Vehicle(s) is discovered to be defective or malfunctioning or has failed or is otherwise not in Good Working Order; (c) keep the Vehicle(s) in the environmental conditions recommended by the manufacturer of the Vehicle(s) or as may be advised in writing from time to time by STC; and (d) not allow any person other than STC’s representatives to adjust, maintain, repair, replace or remove the Vehicle(s) or any part of it, unless otherwise agreed in writing by STC. In the event that the Customer does allow another party to do so, the Customer agrees that STC shall not be liable for any damage caused to the Vehicle by that third party, whether then known or as becomes apparent in the future, and additional costs may apply for repairing any such damage.',
      "5.4 If STC's performance of its obligations under the Contract is prevented or delayed by any act or omission of the Customer, its agents, subcontractors, consultants or employees, STC shall: (a) not be liable for any costs, charges or losses sustained or incurred by the Customer that arise directly or indirectly from such prevention or delay; (b) be entitled to payment of the Charges despite any such prevention or delay; and (c) be entitled to recover any additional costs, charges or losses STC sustains or incurs that arise directly or indirectly from such prevention or delay.",
    ],
  },
  {
    number: '6', heading: 'Charges and payment',
    clauses: [
      '6.1 In consideration of the Services, the Customer shall pay STC the Charges specified in the Contract Details.',
      '6.2 Where STC is performing or has performed the Services in circumstances where it is established that the Vehicle(s) was not, at the time it was delivered to or collected by STC, in Good Working Order due to any of the Excluded Causes, STC may offer to provide the Additional Services and, where instructed by the Customer to provide the Additional Services, may charge, and the Customer shall pay, the Additional Services Charges in respect of that work.',
      '6.3 If on investigation STC reasonably determines that any defect in or malfunctioning of the Vehicle(s) is the result of an Excluded Cause, the Customer shall pay Additional Services Charges in respect of any time incurred by STC in making the investigation and determining the cause of the defect in or malfunctioning of the Vehicle.',
      '6.4 Where: (a) the Services are being provided for a fixed fee, Charges shall be inclusive of all expenses and the cost to STC of any materials or services procured by STC from third parties for the provision of the Services (other than those recoverable in accordance with clause 4.1), but exclusive of the cost of any repairs carried out in accordance with clause 2.5 and / or 2.6; or (b) the Services are not being provided for a fixed fee, any costs that STC incur in order to repair or maintain the Customer’s vehicle to roadworthy condition will be recharged to the Customer.',
      '6.5 Where the Customer has contracted for the Maintenance Services Plan, STC may, unless a different level of increase is agreed between the parties in writing, increase the Charges on an annual basis with effect from each anniversary of the Contract Commencement Date in line with the percentage increase in the Retail Prices Index in the preceding 12 month period, and the first such increase shall take effect on the first anniversary of the Contract Commencement Date and shall be based on the latest available figure for the percentage increase in the Retail Prices Index.',
      '6.6 Without prejudice to any other right or remedy that it may have, if the Customer fails to pay STC any sum due under this agreement on the due date: (a) the Customer shall pay interest on the overdue sum from the due date until payment of the overdue sum, whether before or after judgment; (b) STC may suspend all or part of the Services until payment has been made in full; (c) STC shall have a general and particular lien on the Vehicle(s) in its possession as security for payment of all sums claimed by STC from the Customer.',
      '6.7 All sums payable to STC under this agreement: (a) are exclusive of VAT and the Customer shall in addition pay an amount equal to any VAT chargeable on those sums on delivery of a VAT invoice; and (b) shall be paid in full without any set-off, counterclaim, deduction or withholding (other than any deduction or withholding of tax as required by law).',
    ],
  },
  {
    number: '7', heading: 'Limitation of liability',
    clauses: [
      '7.1 The restrictions on liability in this clause 7 apply to every liability arising under or in connection with the agreement including liability in contract, tort (including negligence), misrepresentation, restitution or otherwise.',
      '7.2 Nothing in the agreement limits any liability which cannot legally be limited, including liability for: (a) death or personal injury caused by negligence; (b) fraud or fraudulent misrepresentation; or (c) breach of the terms implied by section 2 of the Supply of Goods and Services Act 1982 (title and quiet possession).',
      '7.3 Subject to clause 7.2, STC shall have no liability to the Customer for any business losses (including loss of profit, loss of business, business interruption or loss of business opportunity) or for any indirect or consequential losses.',
      "7.4 Subject to clause 7.2 and clause 8.3, STC's total liability to the Customer shall not exceed the total Charges paid or payable by the Customer under the agreement.",
    ],
  },
  {
    number: '8', heading: 'Termination',
    clauses: [
      '8.1 Without affecting any other right or remedy available to it, either party may terminate this agreement with immediate effect by giving written notice to the other party if: (a) the other party fails to pay any amount due under this agreement on the due date for payment and remains in default not less than 14 days after being notified in writing to make such payment; (b) the other party commits a material breach of any term of this agreement and (if such breach is remediable) fails to remedy that breach within a period of 30 days after being notified in writing to do so; (c) the other party takes any step or action in connection with its entering administration, provisional liquidation or any composition or arrangement with its creditors (other than in relation to a solvent restructuring), obtaining a moratorium, being wound up (whether voluntarily or by order of the court, unless for the purpose of a solvent restructuring), having a receiver appointed to any of its assets or ceasing to carry on business or, if the step or action is taken in another jurisdiction, in connection with any analogous procedure in the relevant jurisdiction; (d) the other party suspends, threatens to suspend, ceases or threatens to cease to carry on all or a substantial part of its business; or (e) the other party’s financial position deteriorates so far as to reasonably justify the opinion that its ability to give effect to the terms of the Contract is in jeopardy.',
      "8.2 Without affecting any other right or remedy available to it, STC may terminate this agreement with immediate effect by giving written notice to the Customer if STC reasonably determines that the Vehicle(s) can no longer be maintained in Good Working Order by the provision of Spare Parts or Consumables or the Vehicle(s) is damaged beyond economic repair otherwise than through STC's fault.",
      "8.3 On termination or expiry of this agreement: (a) STC shall no longer be liable to perform any Services; (b) the Customer shall immediately pay to STC all of STC's outstanding unpaid invoices and interest and, in respect of the Services supplied but for which no invoice has been submitted, STC may submit an invoice, which shall be payable immediately on receipt; (c) if the agreement is terminated by STC in accordance with clause 8.1(a) or 8.1(b), the Customer shall immediately pay to STC all Charges which would have been payable for the remainder of the Initial Term or Extended Term (as applicable); and (d) any provision of this agreement that expressly or by implication is intended to come into or continue in force on or after termination or expiry of this agreement shall remain in full force and effect.",
      '8.4 Termination or expiry of this agreement shall not affect any rights, remedies, obligations or liabilities of the parties that have accrued up to the date of termination or expiry, including the right to claim damages in respect of any breach of the agreement which existed at or before the date of termination or expiry.',
    ],
  },
  {
    number: '9', heading: 'Confidentiality',
    clauses: [
      "9.1 Each party undertakes that it shall not disclose to any person any Confidential Information concerning the business, affairs, customers, clients or suppliers of the other party except as permitted by clause 9.2.",
      "9.2 Each party may disclose the other party's Confidential Information: (a) to its employees, officers, representatives, contractors, subcontractors or advisers who need to know such information for the purposes of exercising the party's rights or carrying out its obligations under or in connection with this agreement. Each party shall ensure that its employees, officers, representatives, contractors, subcontractors or advisers to whom it discloses the other party's confidential information comply with this clause 9; and (b) as may be required by law, a court of competent jurisdiction or any governmental or regulatory authority.",
      "9.3 No party shall use any other party's Confidential Information for any purpose other than to exercise its rights and perform its obligations under or in connection with this agreement.",
    ],
  },
  {
    number: '10', heading: 'General',
    clauses: [
      '10.1 Force majeure. STC shall not be in breach of this agreement nor liable for delay in performing, or failure to perform, any of its obligations under this agreement if such delay or failure results from events, circumstances or causes beyond its reasonable control. In such circumstances the time for performance shall be extended by a period equivalent to the period during which performance of the obligation has been delayed or failed to be performed.',
      '10.2 Assignment and other dealings. (a) STC may at any time assign, transfer, mortgage, charge, subcontract, delegate, declare a trust over or deal in any other manner with all or any of its rights or obligations under the Contract. (b) The Customer may not assign, transfer, mortgage, charge, subcontract, delegate, declare a trust over or deal in any other manner with any or all of its rights or obligations under the Contract without the prior written consent of STC.',
      '10.3 Entire agreement. (a) This agreement constitutes the entire agreement between the parties and supersedes and extinguishes all previous agreements, promises, assurances, warranties, representations and understandings between them, whether written or oral, relating to its subject matter. (b) Each party agrees that it shall have no remedies in respect of any statement, representation, assurance or warranty (whether made innocently or negligently) that is not set out in this agreement. Each party agrees that it shall have no claim for innocent or negligent misrepresentation or negligent misstatement based on any statement in this agreement.',
      '10.4 Waiver. No failure or delay by a party to exercise any right or remedy provided under this agreement or by law shall constitute a waiver of that or any other right or remedy, nor shall it prevent or restrict the further exercise of that or any other right or remedy. No single or partial exercise of such right or remedy shall prevent or restrict the further exercise of that or any other right or remedy.',
      '10.5 Severance. If any provision or part provision of the Contract is or becomes invalid, illegal or unenforceable, it shall be deemed deleted, but that shall not affect the validity and enforceability of the rest of the Contract. If any provision of the Contract is deemed deleted under this clause 10.5 the parties shall negotiate in good faith to agree a replacement provision that, to the greatest extent possible, achieves the intended commercial result of the original provision.',
      '10.6 Variation. No variation of this agreement shall be effective unless it is in writing and signed by the parties (or their authorised representatives).',
      '10.7 Third party rights. This agreement does not give rise to any rights under the Contracts (Rights of Third Parties) Act 1999 to enforce any term of this agreement.',
      '10.8 Rights and remedies. The rights and remedies provided under this agreement are in addition to, and not exclusive of, any rights or remedies provided by law.',
      `10.9 Notices. (a) Any notice given to a party under or in connection with the Contract shall be in writing and shall be: (i) delivered by hand or by pre-paid first-class post or other next working day delivery service at its registered office (if a company) or its principal place of business (in any other case); or (ii) sent by email to the following email addresses: STC: ${STC.noticeEmail}; the Customer: the email address set out in the Order. (b) Any notice shall be deemed to have been received: (i) if delivered by hand, at the time the notice is left at the proper address; (ii) if sent by pre-paid first-class post or other next working day delivery service, the second Business Day after posting; or (iii) if sent by email, at the time of transmission, or, if this time falls outside business hours in the place of receipt, when business hours resume. In this clause 10.9(b)(iii), business hours means 9.00am to 5.00pm Monday to Friday on a day that is not a public holiday in the place of receipt. (c) This clause does not apply to the service of any proceedings or other documents in any legal action or, where applicable, any arbitration or other method of dispute resolution.`,
      '10.10 Governing law. This agreement and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation shall be governed by and construed in accordance with the law of England and Wales.',
      '10.11 Jurisdiction. Each party irrevocably agrees that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with this agreement or its subject matter or formation.',
    ],
  },
  {
    number: '11', heading: 'Interpretation',
    clauses: [
      'The following definitions and rules of interpretation apply in this agreement.',
      "11.1 Definitions. Additional Services: any (i) Excluded Services performed by STC under this agreement; or (ii) any services other than those specified as Services in the Contract Details. Applicable Laws: the laws of England and Wales and any other laws or regulations, regulatory policies, guidelines or industry codes which apply to the provision of the Services. Business Day: a day, other than a Saturday, Sunday or public holiday in England, when banks in London are open for business. Business Hours: the period from 9.00am to 5.00pm on any Business Day. Confidential Information: any information which by its nature is confidential, concerning the business, affairs, customers, clients or suppliers of the other party. Consumables: non-durable items used in the operation of the Vehicle. Contract Year: any 12 month period starting on the Contract Commencement Date and on each anniversary of the Contract Commencement Date. Direct Debit: an instruction from the Customer to its bank or building society authorising STC to collect varying amounts from the Customer’s account in accordance with the provisions of the Direct Debit instruction annexed to the Terms and Conditions or otherwise provided to the Customer by STC.",
      'Excluded Causes: (a) a defect in the manufacturer’s design of the Vehicle; (b) faulty materials or workmanship in the manufacture of the Vehicle; (c) the use of the Vehicle(s) with equipment or materials not supplied or approved by STC or the manufacturer; (d) any maintenance, alteration, modification or adjustment performed by persons other than STC or its employees or agents unless approved in writing by STC; (e) the use of the Vehicle(s) in breach of any of the provisions of the agreement under which the Vehicle(s) was supplied; (f) a failure, interruption or surge in the electrical power or its related infrastructure connected to the Vehicle; (g) a failure or malfunctioning of the air conditioning or other environmental controls required for the normal operation of the Vehicle, or an error or omission in the correct use of that air conditioning or other environmental controls by the Customer; or (h) the Customer’s neglect or misuse of the Vehicle.',
      'Excluded Services: any services required to restore any defect or malfunctioning or failure in the Vehicle(s) to Good Working Order where the defect or malfunctioning or failure results from or is caused by any of the Excluded Causes. Good Working Order: operating in accordance with the applicable specification of the manufacturer of the Vehicle. Spare Parts: all spare components and subassemblies of the Vehicle(s) supplied for installation in the Vehicle(s) as part of the provision of the Services. VAT: value added tax chargeable in the UK.',
      '11.2 Defined terms in the Contract Details shall have the meaning given to them in the Contract Details.',
      '11.3 A person includes a natural person, corporate or unincorporated body (whether or not having separate legal personality).',
      '11.4 A reference to a party includes its personal representatives, successors and permitted assigns.',
      '11.5 A reference to legislation or a legislative provision is a reference to it as amended or re-enacted. A reference to legislation or a legislative provision includes all subordinate legislation made under that legislation or legislative provision.',
      '11.6 Any words following the terms including, include, in particular, for example or any similar expression shall be interpreted as illustrative and shall not limit the sense of the words preceding those terms.',
      '11.7 A reference to writing or written excludes fax but not email.',
    ],
  },
];
