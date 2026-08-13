/* =============================================================
   What a database looks like, for the checks.

   The bar learns its values from the database: makes come from
   `stock_trailers.make`, depots from `location`, customers from
   `customer`. A check has no database, so it gets this instead, which
   stands in for what /api/command/vocabulary returns.

   These are values, not phrasings. Nothing here is a sentence, a
   synonym or a way of asking: it is the contents of four columns. That
   distinction is the whole point of the exercise, because a check that
   loaded phrasings would prove only that the phrasings were loaded.
   ============================================================= */
import { setVocabulary } from '../lib/command/vocab';

const MAKES = [
  'DAF', 'Volvo', 'Scania', 'MAN', 'Mercedes', 'Iveco', 'Renault',
  'Schmitz', 'Krone', 'SDC', 'Montracon', 'Cartwright', 'Dennison',
  'Lawrence David', 'Tiger', 'Chereau', 'Gray & Adams', 'Don-Bur',
  'Fruehauf', 'Bailey', 'Wilcox', 'Weightlifter', 'Muldoon', 'Andover',
];

const DEPOTS = [
  'Carrington', 'Bredbury', 'Hyde', 'Haydock', 'Atherton', 'Dukinfield',
  'Birkenhead', 'Stockport', 'Warrington', 'Renbury',
];

const CUSTOMERS = [
  'Dawsongroup', 'Eddie Stobart', 'Culina', 'Wincanton', 'XPO', 'Gregory',
  'Turners', 'Maritime', 'Bibby', 'Suttons', 'Nagel', 'Pollock',
];

const REPS = ['Alex Ellis', 'Dave Brown', 'Tom Hughes', 'John Ridings'];

const MODELS = [
  'Curtainsider', 'Tautliner', 'Box Van', 'Fridge', 'Flatbed', 'Skeletal',
  'Tipper', 'Low Loader', 'Double Deck', 'Moffett', 'Step Frame',
];

const rows = (list: string[], n = 40) => list.map((value, i) => ({ value, rows: n - i }));

export function loadSampleVocabulary(): void {
  setVocabulary('trailers', {
    make: rows(MAKES, 400),
    model: rows(MODELS, 300),
    location: rows(DEPOTS, 200),
    customer: rows(CUSTOMERS, 90),
    sales_rep: rows(REPS, 150),
  });
  setVocabulary('contacts', {
    location: rows(DEPOTS, 60),
    assigned_to: rows(REPS, 80),
  });
  setVocabulary('deals', {
    company_name: rows(CUSTOMERS, 70),
    location: rows(DEPOTS, 50),
    assigned_to: rows(REPS, 80),
  });
}
