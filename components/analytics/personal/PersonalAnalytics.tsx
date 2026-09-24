'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw, TrendingDown, TrendingUp, UserRound, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  readable, fsCandidates, fsAnswerInvoice, fsAnswerAll, type FsCandidate,
} from '@/lib/protean/rpc';
import { useToast } from '@/components/kit/toast';
import type { Viewable } from '@/lib/analytics/scope';
import {
  Alert, Badge, Button, Chip, EmptyState, PageHead, compactMoney,
} from '@/components/kit/primitives';
import { Select, TextInput } from '@/components/kit/forms';
import { Note, Panel, PanelGrid } from '@/components/analytics/legacy/panel';
import { Tile } from '@/components/analytics/legacy/tiles';
import { DealPill, PortfolioDeals, type DealState } from './PortfolioDeals';
import { PortfolioChange } from './PortfolioChange';
import { PortfolioCustomers } from './PortfolioCustomers';
import { readChoice, writeChoice } from '@/lib/ui/remember';

/* =============================================================
   Personal Analytics: one person's portfolio.

   From the agreed development scope, Task 2:

     This is not a salesperson leaderboard. It answers: How is this
     person's customer portfolio performing?

   ---- What feeds the target figure, written down ----

   The scope asks for this to be documented rather than assumed, and
   the business settled it:

     the 600k target thing will come from pipeline on the tracker

   So every figure on this screen comes from `crm_leads`, the tracker,
   through `personal_pipeline` and `personal_overview` in migration 119.
   A person's portfolio is the deals whose `owner_id` is them. That is a
   real column pointing at a real profile, so nothing here matches a
   name against a name.

   TARGET BEARING REVENUE IS WON WORK, EXCLUDING TRAILER SALES, DATED
   INTO THIS FINANCIAL YEAR BY ITS ORDER DATE. Trailer Sales is beside
   it and never added into it, because the scope says so in as many
   words. Open pipeline is beside both and is never called revenue.

   ---- Nothing here is zero because it is unknown ----

     Unknown figures must be null/not known, never zero.

   `money` below prints "Not known" for null and "£0" for nought, and
   the two are different sentences. There is no percentage against a
   missing target: a percentage of nothing is not nought.
   ============================================================= */

type Overview = {
  person_id: string;
  full_name: string | null;
  financial_year: string;
  fy_target: number | null;
  target_revenue: number | null;
  trailer_revenue: number | null;
  open_pipeline: number | null;
  open_deals: number;
  won_deals: number;
  lost_deals: number;
  customers: number;
  unpriced: number;
  won_undated: number;
  achieved: number | null;
  to_go: number | null;
  /* Migration 126. Won work to the as at date, against the same point
     last year. `target_revenue` above is the whole financial year,
     because that is what a target is measured against; these two are
     capped at the date being asked about, because that is what a fair
     comparison needs. */
  won_to_date: number | null;
  last_year_won: number | null;
  won_change: number | null;
  won_change_pct: number | null;
  /* Migration 133. The target figure's two halves, named, so it can be
     checked rather than trusted. */
  tracker_revenue: number | null;
  /* Migration 134. Two figures, and only one of them counts.
     Value won is the whole term the moment it is accepted. Value
     invoiced is money actually billed, and that is what the target
     is measured on. */
  fs_value_won: number | null;
  fs_value_invoiced: number | null;
  fs_contracts: number;
  fs_contract_only: boolean;
  /* How many invoices are waiting to be answered. A figure with a
     queue behind it says so rather than looking finished. */
  fs_waiting: number;
  fs_waiting_worth: number | null;
  /* Migration 160. The two halves of the target figure, so the tile
     can show its own arithmetic. */
  invoiced_this_year: number | null;
  invoiced_last_year: number | null;
  /* Migration 158. Rows off an imported customer sheet, which are not
     deals and are in none of the figures above. */
  off_a_sheet: number;
};

/* The portfolio's invoiced revenue, this year against the same point
   last year. A different basis from the tiles above and labelled as
   one: this is money that came in through the uploads, not won work on
   the tracker. */
type RevenueYear = {
  year_from: string;
  year_to: string;
  last_from: string;
  last_to: string;
  this_year: number;
  last_year: number;
  change: number;
  change_pct: number | null;
  customers: number;
  with_revenue: number;
  /* Three numbers, not one. Migration 155. The old `not_bound` counted
     every customer with no Protean account and called it a gap, which
     is mostly a count of prospects nobody has ever billed. Saying that
     about 108 of somebody's 257 customers reads as a hole in the
     accounts, and it is not one. */
  never_billed: number;
  split_twin: number;
  payer_on_book: number;
};

type PipelineRow = {
  lead_type: string;
  open_count: number;
  open_total: number | null;
  won_count: number;
  won_total: number | null;
  lost_count: number;
  lost_total: number | null;
  unpriced: number;
  won_undated: number;
  /** What the undated wins would add if somebody dated them. Migration 162. */
  won_undated_worth: number | null;
  /* Each gap against the one figure it moves. Migration 163. */
  unpriced_open: number;
  unpriced_won: number;
  undated_priced: number;
  /* The won figure with the FleetSmart+ deals taken out, which is what
     the target uses. Migration 159: a contract counts towards a target
     by what it has billed, never by its headline value. */
  won_total_own: number | null;
  /* Migration 158. Rows that came off an imported sheet carrying what
     a customer spent in a past year. They are not deals, they have no
     order date and they never reach a target, so they are counted
     apart rather than reported as work somebody has failed to price
     or failed to date. */
  off_a_sheet: number;
};

type Mover = {
  contact_id: string;
  company_name: string | null;
  this_year: number;
  last_year: number;
  change: number;
  change_pct: number | null;
  divisions: string | null;
};

/** The tracker's three deal types, in the words the business uses. */
const TYPE_LABEL: Record<string, string> = {
  maintenance: 'Maintenance and STC',
  rental: 'Rentals',
  trailer_sales: 'Trailer Sales',
};

const ORDER = ['maintenance', 'rental', 'trailer_sales'];

/** Money, and the difference between nought and not known. */
const money = (n: number | null | undefined): string =>
  (n == null ? 'Not known' : compactMoney(Number(n)));

const num = (n: number | null | undefined): number | null =>
  (n == null ? null : Number(n));

/** How many movers each list shows. The company panels show ten. */
const SHOW_MOVERS = 10;

/* The two divisions a customer is billed under, and both together.
   `stc` is the maintenance and workshop side: the slug is older than
   the word the business uses for it, and renaming a slug renames it in
   every invoice already imported. */
const MOVER_SIDES = ['stc', 'rental', 'both'] as const;
type MoverSide = typeof MOVER_SIDES[number];
const SIDE_LABEL: Record<MoverSide, string> = {
  stc: 'Maintenance', rental: 'Rentals', both: 'Both',
};

export function PersonalAnalytics({
  person, people, selfId, asked, onAsked, onLeave, onPerson,
}: {
  person: string;
  people: Viewable[];
  selfId: string | null;
  /** The as-at date, shared with the company screen so it survives the switch. */
  asked: string;
  onAsked: (v: string) => void;
  onLeave: () => void;
  onPerson: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const upto = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : undefined;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  /* How many rows on this tracker came off an imported sheet rather
     than being deals. Migration 158; see the alert below. */
  const sheetRows = overview?.off_a_sheet ?? pipeline.reduce((n, r) => n + (r.off_a_sheet ?? 0), 0);
  /* What the undated wins would add if somebody dated them. Migration
     162. NULL where not one of them carries a price or an estimate,
     which is a different sentence from nought. */
  const undatedWorth = pipeline.some((r) => r.won_undated_worth != null)
    ? pipeline.reduce((n, r) => n + Number(r.won_undated_worth ?? 0), 0)
    : null;
  /* Counted per figure rather than in one lump. Migration 163: the old
     lump was 70, of which 20 were lost deals and 8 were wins, so a
     sentence about the open pipeline was quoting a number that was two
     thirds about something else. */
  const sum = (f: (r: PipelineRow) => number | null | undefined) =>
    pipeline.reduce((n, r) => n + Number(f(r) ?? 0), 0);
  const openDeals = sum((r) => r.open_count);
  const unpricedOpen = sum((r) => r.unpriced_open);
  const unpricedWon = sum((r) => r.unpriced_won);
  const undatedPriced = sum((r) => r.undated_priced);
  const undated = sum((r) => r.won_undated);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [revYear, setRevYear] = useState<RevenueYear | null>(null);
  const [queue, setQueue] = useState<FsCandidate[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const { say } = useToast();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  /* WHICH DIVISION THE MOVERS ARE READ FOR.

     From the business: "biggest gainers should only show maintenance,
     rental, or both, buttons to switch". The slugs are the Protean
     ones, because a customer is BILLED under a division rather than
     pitched to under one. It is a preference, so it lasts the reload:
     `lib/ui/remember.ts`, the same as every other saved choice. */
  const [side, setSide] = useState<MoverSide>(
    () => readChoice<MoverSide>('portfolio-mover-side', MOVER_SIDES) ?? 'both',
  );

  /* The pill somebody pressed, and the list it opens. */
  const [deals, setDeals] = useState<
    { type: string; label: string; state: DealState } | null
  >(null);

  /* The drawer behind the invoiced row. */
  const [breakdown, setBreakdown] = useState(false);

  /* ---- Every panel moves together, or none of them do ----

     From the scope: "Selecting a person refreshes the entire Personal
     scope consistently [...] No panel may remain scoped to the previous
     person."

     So there is ONE load for the whole screen and one piece of state
     holding its answer. A panel cannot be left on the last person
     because no panel owns its own request. */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    /* Cleared rather than left showing while the next person loads. Two
       seconds of somebody else's revenue under a new name is worse than
       two seconds of nothing. */
    setOverview(null);
    setPipeline([]);
    setMovers([]);
    setRevYear(null);
    setQueue([]);
    try {
      /* The queue is a side question and must never stop the figures
         drawing, so it is fetched separately and its failure is shown
         on the panel rather than over the whole screen. */
      void fsCandidates(supabase, person).then(setQueue).catch(() => setQueue([]));
      const [o, p, m, y] = await Promise.all([
        supabase.rpc('personal_overview', { p_person: person, p_when: upto ?? null }),
        supabase.rpc('personal_pipeline', { p_person: person, p_when: upto ?? null }),
        supabase.rpc('personal_movers', {
          p_person: person, p_upto: upto ?? null, p_limit: SHOW_MOVERS * 2,
          p_division: side === 'both' ? null : side,
        }),
        supabase.rpc('personal_revenue_year', { p_person: person, p_upto: upto ?? null }),
      ]);
      if (o.error) throw readable(o.error);
      if (p.error) throw readable(p.error);
      if (m.error) throw readable(m.error);
      if (y.error) throw readable(y.error);

      setOverview(((o.data ?? []) as Overview[])[0] ?? null);
      setPipeline((p.data ?? []) as PipelineRow[]);
      setMovers((m.data ?? []) as Mover[]);
      setRevYear(((y.data ?? []) as RevenueYear[])[0] ?? null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The figures would not load.');
    } finally {
      setLoading(false);
    }
  }, [supabase, person, upto, side]);

  useEffect(() => { void load(); }, [load]);

  /* ---- Answering the queue ----

     Every press reaches the database, is refused by the same
     capability the button is gated on, and the screen redraws from
     what actually happened rather than from what was attempted. */
  const answer = useCallback(async (c: FsCandidate, yes: boolean) => {
    const key = `${c.contract_id}:${c.division}:${c.invoice_no}`;
    setAnswering(key);
    try {
      await fsAnswerInvoice(supabase, c.contract_id, c.division, c.invoice_no, yes);
      say({
        tone: 'success',
        title: yes
          ? `Invoice ${c.invoice_no} counts towards ${c.customer_name}'s contract.`
          : `Invoice ${c.invoice_no} is not contractual, and will not be asked again.`,
      });
      await load();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setAnswering(null); }
  }, [supabase, say, load]);

  const answerAll = useCallback(async (c: FsCandidate, yes: boolean) => {
    setAnswering(c.contract_id);
    try {
      const n = await fsAnswerAll(supabase, c.contract_id, yes);
      say({
        tone: 'success',
        title: `${n} invoice(s) on ${c.customer_name} marked ${yes ? 'contractual' : 'not contractual'}.`,
      });
      await load();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setAnswering(null); }
  }, [supabase, say, load]);

  const who = people.find((p) => p.id === person) ?? null;
  const isSelf = person === selfId;
  const canSwitch = people.length > 1;

  const gainers = movers.filter((m) => Number(m.change) > 0).slice(0, SHOW_MOVERS);
  const fallers = movers
    .filter((m) => Number(m.change) < 0)
    .sort((a, b) => Number(a.change) - Number(b.change))
    .slice(0, SHOW_MOVERS);

  const year = overview?.financial_year
    ? new Date(`${overview.financial_year}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short', year: 'numeric',
    })
    : null;

  return (
    <div className="kit" style={{ padding: '18px 24px 40px', maxWidth: 1480, margin: '0 auto' }}>
      {/* ---- the control bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '2px 0 12px',
      }}>
        <PageHead
          eyebrow="Analytics, personal"
          title={who?.full_name ?? overview?.full_name ?? 'This portfolio'}
          sub={year
            ? `The portfolio year from ${year}, against the same point in the year before it.`
            : 'One person’s portfolio, across maintenance, rentals and trailer sales.'}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* The selector holds only people the database says this
              person may open. It is drawn from the same function the
              rule is made of, so it cannot offer somebody who would
              then be refused. */}
          {canSwitch && (
            <div style={{ width: 230 }}>
              <Select
                value={person}
                onChange={onPerson}
                title="Whose portfolio to show"
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}{p.is_self ? ' (you)' : ''} · {p.role_name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Chip active onClick={onLeave} title="Back to the company and its divisions">
            <UserRound size={12} /> Personal
          </Chip>
          <Button variant="ghost" size="sm" onClick={onLeave} title="Leave the personal view">
            <X size={12} /> Whole company
          </Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 146 }}>
            <TextInput type="date" value={asked} onChange={onAsked} />
          </div>
          {asked && (
            <Button variant="ghost" size="sm" onClick={() => onAsked('')}>
              <RotateCcw size={12} /> Today
            </Button>
          )}
        </div>
      </div>

      {!isSelf && who && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="info">
            <span style={{ flex: 1 }}>
              Every figure below is {who.full_name}&#8217;s portfolio, not yours.
            </span>
            {selfId && (
              <Button variant="secondary" size="sm" onClick={() => onPerson(selfId)}>
                Back to mine <ArrowRight size={12} />
              </Button>
            )}
          </Alert>
        </div>
      )}

      {failed && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">
            <span style={{ flex: 1 }}>{failed}</span>
            <Button variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>
          </Alert>
        </div>
      )}

      {/* ---- the headline ---- */}
      <div style={{
        /* Three across, asked for by name once the Customers card came
           off and nine were left.

           Twelve columns with each tile taking four, not three columns
           with each tile taking one. A Tile's own default is `span 3`,
           written for the twelve column grids everywhere else in this
           file, so a three column container gave every tile the whole
           row: nine cards full width, each three quarters empty, which
           is the layout the business has twice said is banned. The
           container was right and the screen was wrong, which is why
           the check now measures where the tiles land rather than what
           the container says.

           `minmax(0, 1fr)` rather than a width, so a long figure
           shrinks its column instead of pushing the row sideways. */
        display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
      }}>
        <Tile
          span={4}
          noteWraps
          label="Target, this year"
          value={overview?.fy_target == null ? 'Not set' : money(num(overview.fy_target))}
          note={overview?.fy_target == null
            ? 'Nobody has set one. That is not the same as nought.'
            : year ? `Financial year from ${year}` : undefined}
        />
        {/* ---- WHAT THE BUSINESS PAYS ON ----

            From the business:

              Dean's target is £600k fixed. He earns revenue on
              anything that exceeds last year's sales [...] the
              £256,000 card should track all his revenue as it's simply
              just a mirror of his "towards target" figure with a
              comparison against last year.

              You, yourself, should be EXTREMELY concerned that you
              have one card saying he's made 256k and another saying
              only 52k [...] that's literally paying dean's commission.

            This tile and the revenue panel below now read the SAME
            number out of the same function, so they cannot differ
            again. Migration 160. */}
        <Tile
          span={4}
          noteWraps
          label="Towards target"
          value={money(num(overview?.target_revenue))}
          note={`Everything these customers were billed above the same point last year.`
            + ` ${money(num(overview?.invoiced_this_year))} this year against`
            + ` ${money(num(overview?.invoiced_last_year))} then.`}
        />
        {/* ---- WHAT IS LEFT, AND HOW FAR THROUGH THAT IS ----

            From the business:

              Left to find should be card 3 always so you're showing
              target, current progress, progress left all on 1 line.

            and then:

              merge left to find and achieved together so 9 cards
              total.

            Which is right twice over. The percentage was never a
            second fact: 42.6% achieved and £344k left to find are the
            same sentence said two ways, and splitting them cost a card
            and left nine cards that would not divide by three. One
            card, both figures, and the row divides.

            This card never disappears and never changes places, which
            is what makes "card 3 always" a promise the check can hold
            the page to. Past the target it relabels itself and shows
            the overshoot, same card, same place. */}
        <Tile
          span={4}
          noteWraps
          label={Number(overview?.to_go ?? 0) < 0 ? 'Ahead of target' : 'Left to find'}
          value={overview?.to_go == null
            ? 'Not known'
            : money(Math.abs(Number(overview.to_go)))}
          tone={overview?.to_go != null && Number(overview.to_go) > 0 ? 'warning' : 'plain'}
          note={overview?.fy_target == null
            ? 'No target to measure against'
            : overview?.achieved == null
              ? `against the ${money(num(overview?.fy_target))} target.`
              : `${Number(overview.achieved).toFixed(1)}% of the`
                + ` ${money(num(overview?.fy_target))} target reached.`}
        />
        {/* The same figure as Towards target, said the other way
            round. Migration 160 made them one number. */}
        <Tile
          span={4}
          noteWraps
          label={overview?.won_change == null
            ? 'Against last year'
            : Number(overview.won_change) < 0 ? 'Down on last year' : 'Up on last year'}
          value={overview?.won_change == null
            ? 'Not known'
            : `${Number(overview.won_change) > 0 ? '+' : ''}${money(Number(overview.won_change))}`}
          tone={overview?.won_change == null
            ? 'plain'
            : Number(overview.won_change) < 0 ? 'warning' : 'plain'}
          note={overview?.won_change_pct == null
            ? 'Nothing billed to these customers last year to compare with.'
            : `${Number(overview.won_change_pct) > 0 ? '+' : ''}`
              + `${Number(overview.won_change_pct).toFixed(1)}% on the same point last year.`}
        />
        <Tile
          span={4}
          noteWraps
          label="FS+ value won"
          value={money(num(overview?.fs_value_won))}
          note={`${overview?.fs_contracts ?? 0} contract(s) accepted this year, over their whole term. Not counted towards the target.`}
        />
        <Tile
          span={4}
          noteWraps
          label="FS+ value invoiced"
          value={money(num(overview?.fs_value_invoiced))}
          tone={(overview?.fs_waiting ?? 0) > 0 ? 'warning' : 'plain'}
          note={(overview?.fs_waiting ?? 0) > 0
            ? `Billed and in the bank. ${overview?.fs_waiting} invoice(s) worth `
              + `${money(num(overview?.fs_waiting_worth))} are still waiting to be confirmed below.`
            : 'Billed and in the bank. This is the half that counts towards the target.'}
        />
        {/* Kept, and labelled for what it is. This was the target
            figure until migration 160 and it is the number that read
            £52k beside a £256k one. It is work closed on the tracker,
            which is a different question from what the book billed.

            It is the same column, and the same sum, as the "Across the
            three" table further down: migration 161, after the tile
            read £52k over a table whose two rows came to £89k. */}
        <Tile
          span={4}
          noteWraps
          label="Closed on the tracker"
          value={money(num(overview?.tracker_revenue))}
          note={'Maintenance and rentals off the tracker, the FleetSmart+ contracts '
            + 'above included at their whole term value. Not revenue, and not what '
            + 'the target is measured on.'}
        />
        <Tile
          span={4}
          noteWraps
          label="Open pipeline"
          value={money(num(overview?.open_pipeline))}
          note={`${overview?.open_deals ?? 0} open deal(s). Not revenue.`}
        />
        <Tile
          span={4}
          noteWraps
          label="Trailer Sales"
          value={money(num(overview?.trailer_revenue))}
          note="Reported here, and kept out of the target figure."
        />
      </div>

      {/* ---- WHAT THE FIGURES CANNOT TELL YOU, AND WHAT IT IS WORTH ----

          Said on the screen rather than swallowed. A portfolio with
          eleven unpriced deals in it has a pipeline figure that is
          smaller than the pipeline, and nobody can tell from the
          number.

          From the business, about this notice and the two below it:

            He thinks these are lost earnings because it's saying
            things are or are not included or are being worked out
            differently.

          Which is what a count on its own does to somebody paid on a
          number. Three sentences saying what is excluded, no sentence
          saying what any of it is worth, so the reader supplies the
          worst figure they can imagine.

          So each one now names the figure it moves, and the notice
          opens by saying the target is not one of them. That is true
          by construction since migration 160: the target is what these
          customers were invoiced, and no deal on this tracker can
          reach it in either direction. */}
      {overview && (unpricedOpen > 0 || unpricedWon > 0 || undated > 0 || sheetRows > 0) && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="warning">
            <span style={{ flex: 1 }}>
              <strong>None of this changes your target.</strong> The target is measured
              on what these customers were invoiced, so nothing on the tracker can add
              to it or take from it.{' '}
              {unpricedOpen > 0 && (
                <>{unpricedOpen} of your {openDeals} open deals carry no figure. They are
                counted in Open pipeline above and add nothing to its total, because
                nobody has priced them yet. </>
              )}
              {undatedPriced > 0 && (
                <>{undatedPriced} won deal{undatedPriced === 1 ? '' : 's'}{' '}
                {undatedPriced === 1 ? 'is' : 'are'} worth {money(undatedWorth ?? 0)} and{' '}
                {undatedPriced === 1 ? 'has' : 'have'} no order date, so{' '}
                {undatedPriced === 1 ? 'it is' : 'they are'} not in Closed on the tracker.
                Put a date on {undatedPriced === 1 ? 'it' : 'them'} and that lands. </>
              )}
              {unpricedWon > 0 && (
                <>{unpricedWon} won deal{unpricedWon === 1 ? '' : 's'} carry no figure at
                all, so {unpricedWon === 1 ? 'it adds' : 'they add'} nothing to Closed on
                the tracker whatever happens to{' '}
                {unpricedWon === 1 ? 'its date' : 'their dates'}. </>
              )}
              {/* Said in the same breath, because this warning used to
                  read "146 won deals have no order date" when 131 of
                  those were rows off an imported sheet carrying last
                  year's spend. Telling a rep that £2.7m of last year's
                  turnover is missing from his target is worse than
                  saying nothing. Migration 158 moved that figure into
                  `sheet_revenue` and this says what is left. */}
              {sheetRows > 0 && (
                <>Separately, {sheetRows} row{sheetRows === 1 ? '' : 's'} on this
                tracker came off an imported customer sheet and hold what that
                customer spent in a past year. They are not deals, and they are
                counted in none of the figures above.</>
              )}
            </span>
          </Alert>
        </div>
      )}

      <PanelGrid>
        {/* ---- the three divisions, from one screen ---- */}
        {/* ---- TWO TO A ROW, NOT ONE ----

            From the business: "Across the three and What this portfolio
            invoiced, against last year should be in a 2 column layout not
            taking up a whole row each, 80% of them is currently blank
            space which the brand kit bans anyway."

            Six of twelve each, which is what the two mover panels below
            already do, so nothing here is a new measurement. The grid
            stretches every panel on a row to the tallest, so the pair is
            the same height by construction.

            THEY ARE ALSO NOW ADJACENT, and that is the half that makes
            it hold. The contract question used to sit between them, and
            it is a full width panel that only appears when there is
            something to answer. Left where it was, these two would pair
            on the days it was empty and each sit alone beside six columns
            of nothing on the days it was not, which is the fault being
            reported. */}
        <Panel
          span={6}
          title="Across the three"
          hint="Maintenance, rentals and trailer sales, without switching tabs"
          table={{
            columns: ['Open pipeline', 'Open', 'Won this year', 'Won', 'Lost'],
            rows: ORDER.filter((t) => pipeline.some((p) => p.lead_type === t)).map((t) => {
              const row = pipeline.find((p) => p.lead_type === t)!;
              return {
                name: TYPE_LABEL[t] ?? t,
                cells: [
                  money(num(row.open_total)),
                  String(row.open_count),
                  money(num(row.won_total)),
                  String(row.won_count),
                  String(row.lost_count),
                ],
              };
            }),
          }}
        >
          {pipeline.length === 0 ? (
            <EmptyState
              what={loading ? 'Reading the tracker' : 'No deals on this portfolio'}
              why={loading
                ? 'One moment.'
                : 'Nothing on the tracker is owned by this person yet.'}
            />
          ) : (
            <div style={{ display: 'grid', gap: 10, padding: 12 }}>
              {ORDER.map((t) => {
                const row = pipeline.find((p) => p.lead_type === t);
                if (!row) return null;
                return (
                  <div
                    key={t}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                      padding: '10px 12px',
                      border: '1px solid var(--border)', borderRadius: 'var(--r)',
                      background: 'var(--surface-sunken)',
                    }}
                  >
                    <strong style={{ minWidth: 168, fontSize: 13 }}>{TYPE_LABEL[t] ?? t}</strong>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Won this year <strong style={{ color: 'var(--text)' }}>
                        {money(num(row.won_total))}
                      </strong>
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Open pipeline <strong style={{ color: 'var(--text)' }}>
                        {money(num(row.open_total))}
                      </strong>
                    </span>
                    {/* PRESS ONE AND SEE THE RECORDS.

                        "make it so you can click 'open' or 'won' or
                        'lost' pills and see a list of those records".
                        A pill with nothing behind it is not a button,
                        it is a number, so it stays a badge. */}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <DealPill
                        count={row.open_count} label="open"
                        disabled={row.open_count === 0}
                        onOpen={() => setDeals({
                          type: t, label: TYPE_LABEL[t] ?? t, state: 'open',
                        })}
                      />
                      <DealPill
                        count={row.won_count} label="won"
                        disabled={row.won_count === 0}
                        onOpen={() => setDeals({
                          type: t, label: TYPE_LABEL[t] ?? t, state: 'won',
                        })}
                      />
                      {row.lost_count > 0 && (
                        <DealPill
                          count={row.lost_count} label="lost"
                          onOpen={() => setDeals({
                            type: t, label: TYPE_LABEL[t] ?? t, state: 'lost',
                          })}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
              <Note>
                Won this year is work with an order date inside the financial year. Open
                pipeline is still winnable and is not revenue.
              </Note>
            </div>
          )}
        </Panel>

        {/* ---- the other last year, and it is a different number ----

            The tiles above are WON WORK on the tracker, which is what
            the target is measured on. This is what the portfolio's
            customers were INVOICED, out of the uploads, which is what
            the company Analytics screen and the two lists below read.
            Both are real and they do not agree, so both are on the
            screen saying which is which rather than one of them being
            picked quietly. */}
        <Panel
          span={6}
          title="What this portfolio invoiced, against last year"
          /* "is not the target figure" is the whole point of this line.
             This panel is what the group billed these customers. The
             target above is what this person won. Two honest numbers
             about one person, and nothing on the screen said they were
             different questions. */
          /* Short enough to be read. A panel hint is drawn on one line
             and clipped with an ellipsis, so the sentence that matters
             most on this panel was ending in "..." and was in the one
             place on the screen it could not be read. It is now a line
             of its own under the figures. */
          hint="What the group billed these customers, from the uploads."
        >
          {!revYear ? (
            <EmptyState
              what={loading ? 'Reading the invoices' : 'No invoiced revenue to compare'}
              why={loading
                ? 'One moment.'
                : 'None of this portfolio&#8217;s customers is bound to a Protean or Sage account yet.'}
            />
          ) : (
            <div style={{ display: 'grid', gap: 10, padding: 12 }}>
              {/* Clickable, asked for by name: "make the row clickable
                  so you can see what makes up this 256k in detail".
                  A button rather than a div with an onClick, so it
                  reaches the keyboard and says what it is. */}
              <button
                type="button"
                onClick={() => setBreakdown(true)}
                title="See which customers this change is made of"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                  padding: '12px 14px', width: '100%', textAlign: 'left',
                  border: '1px solid var(--border)', borderRadius: 'var(--r)',
                  background: 'var(--surface-sunken)', cursor: 'pointer',
                  font: 'inherit', color: 'inherit',
                }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  This year to date <strong style={{
                    color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                  }}>{money(Number(revYear.this_year))}</strong>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Same point last year <strong style={{
                    color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                  }}>{money(Number(revYear.last_year))}</strong>
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {Number(revYear.change) < 0
                    ? <TrendingDown size={14} color="var(--danger)" />
                    : <TrendingUp size={14} color="var(--success)" />}
                  <strong style={{
                    fontSize: 15, fontVariantNumeric: 'tabular-nums',
                    color: Number(revYear.change) < 0 ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {Number(revYear.change) > 0 ? '+' : ''}{money(Number(revYear.change))}
                  </strong>
                  {/* "on last year", because this percentage sits a few
                      centimetres from the Achieved tile, which is a
                      percentage of the target, and the two were read as
                      one. From the business, looking at both at once:
                      "So how is his target already at 16% - 256k of his
                      600k target that you are counting here". It was
                      not: 16.0% is growth, and £256k of £600k is 42.6%.
                      Neither number was wrong and neither said what it
                      was a percentage of. */}
                  {revYear.change_pct != null && (
                    <Badge tone={Number(revYear.change) < 0 ? 'warning' : 'success'}>
                      {Number(revYear.change_pct) > 0 ? '+' : ''}
                      {Number(revYear.change_pct).toFixed(1)}% on last year
                    </Badge>
                  )}
                  <ArrowRight size={14} style={{ opacity: 0.6 }} />
                </span>
              </button>

              {/* NOTHING GOES HERE THAT IS AN ARGUMENT RATHER THAN A FACT.

                  This held "This change IS the Towards target figure
                  above: one number, drawn twice." From the business:

                    Comments like this should not make it through.
                    That's a note for me, not a production note for a
                    live app being used by multiple teams.

                  Right. It was me showing my working to one person, on
                  a screen several teams read every day. That the two
                  figures are one number is held true by
                  `portfolio_audit` and by `check:personal-portfolio`,
                  which is where a guarantee belongs. It does not need
                  arguing for on the screen. */}

              {/* A customer with no Protean account has no invoiced
                  figure, and that is not nought. Said out loud rather
                  than quietly making the total smaller. */}
              {/* ---- THE ONE THAT MATTERS, AND ONLY IT ----

                  A company held twice splits its own revenue across two
                  records, so this portfolio reads one half and some
                  other screen reads the other. Neither is what the
                  customer spends. The company and division totals are
                  unaffected, which is exactly why this survives an
                  audit, and it is why it has to be said here.

                  Nothing else gets an alert. A prospect with no Protean
                  account is a prospect, not a fault. */}
              {revYear.split_twin > 0 && (
                <Alert tone="warning">
                  <span style={{ flex: 1 }}>
                    {revYear.split_twin} of this portfolio&#8217;s {revYear.customers} customers
                    {revYear.split_twin === 1 ? ' is' : ' are'} entered twice under
                    {revYear.split_twin === 1 ? ' a second spelling' : ' second spellings'}, and
                    the revenue is on the other record. The figures above are missing it. The
                    division totals are not affected. Merging them puts it back.
                  </span>
                </Alert>
              )}

              {/* WORTH NOUGHT, AND IT SAYS SO.

                  `payer_on_book` only counts a record with no Protean
                  account and no invoice against it, so every one of
                  them carries exactly nothing in either year. That is
                  by construction in `personal_revenue_year`, not a
                  fact about today's data.

                  It used to end "so they should not be on a portfolio
                  at all", which reads to somebody paid on this number
                  as though their figure had been reduced. Nothing was
                  reduced. Taking them off changes no figure on this
                  screen, and the sentence now says that. */}
              {revYear.payer_on_book > 0 && (
                <Alert tone="info">
                  <span style={{ flex: 1 }}>
                    {revYear.payer_on_book} of these {revYear.payer_on_book === 1 ? 'is' : 'are'} an
                    insurer or other payer rather than a customer, and{' '}
                    {revYear.payer_on_book === 1 ? 'it has' : 'none of them has'} been invoiced
                    through this portfolio in either year. {revYear.payer_on_book === 1
                      ? 'It adds' : 'They add'} nothing to the figures above and taking{' '}
                    {revYear.payer_on_book === 1 ? 'it' : 'them'} off would change none of them.
                    What a payer settles is counted against whoever the work was done for.
                  </span>
                </Alert>
              )}

              <Note>
                {new Date(`${revYear.year_from}T00:00:00`).toLocaleDateString('en-GB')} to
                {' '}{new Date(`${revYear.year_to}T00:00:00`).toLocaleDateString('en-GB')}, against
                {' '}{new Date(`${revYear.last_from}T00:00:00`).toLocaleDateString('en-GB')} to
                {' '}{new Date(`${revYear.last_to}T00:00:00`).toLocaleDateString('en-GB')}. Invoice
                net by tax point. The target is measured on the change between them.
                {revYear.never_billed > 0 && (
                  <> {revYear.never_billed} of the {revYear.customers} customers here have never
                  been billed, which is what a prospect is: nobody has sold them anything
                  yet. They are counted in the list and add nothing to either figure, and
                  nothing is missing on their account.</>
                )}
              </Note>
            </div>
          )}
        </Panel>

        {/* ---- is this invoice the contract, or is it ad hoc work ----

            From the business: "you need a checker that listens to
            invoices at the same value for the same customer and it can
            ask me if the invoice is contractual or not."

            So the contract's monthly charge is matched against every
            division, STC first because three in four are, and NOTHING
            counts until somebody presses one of these. */}
        {queue.length > 0 && (
          <Panel
            span={12}
            title="Is this invoice part of the contract?"
            hint="Matched on the contract's monthly charge, across all three divisions. Nothing counts towards the target until it is answered."
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {queue.map((c) => {
                const key = `${c.contract_id}:${c.division}:${c.invoice_no}`;
                const busy = answering === key || answering === c.contract_id;
                return (
                  <div
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                      padding: '10px 14px', borderBottom: '1px solid var(--border)',
                      fontSize: 13,
                    }}
                  >
                    <strong style={{ minWidth: 170 }}>{c.customer_name}</strong>
                    <Badge tone="neutral">{c.division_name}</Badge>
                    <span style={{ color: 'var(--text-muted)' }}>
                      Invoice {c.invoice_no}, {new Date(`${c.tax_point}T00:00:00`)
                        .toLocaleDateString('en-GB')}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{money(Number(c.net))}</strong>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' '}against {money(Number(c.monthly_total))} a month
                      </span>
                    </span>
                    {!c.exact && <Badge tone="warning">pennies out</Badge>}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void answer(c, true)}
                      >
                        Yes, contractual
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void answer(c, false)}
                      >
                        No
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void answerAll(c, true)}
                        title={`Mark every waiting invoice on ${c.customer_name}'s contract as contractual`}
                      >
                        Yes to all
                      </Button>
                    </span>
                  </div>
                );
              })}
              <Note>
                A direct debit is the same figure every month, so &#8220;Yes to all&#8221; answers
                the rest of that contract in one press. Every answer is written down per invoice
                and never asked again.
              </Note>
            </div>
          </Panel>
        )}

        {/* ---- WHO THEY ARE AND WHAT THEY SPEND ----

            "personal portfolio should have a list like the revenue tab
            of customers and their revenue. limit to 20 rows with
            scrolling. can click into a customer and see their broken
            down revenue, set reminder button against each, compare
            against another customer."

            All four of those are in the one component, because they are
            one thing somebody does: look down the list, stop on a name,
            see where the money comes from, and either put a reminder on
            it or hold it up against somebody else. */}
        <Panel
          span={12}
          title="Customers on this portfolio"
          hint="What each one has spent this financial year, against the same point last year"
        >
          <PortfolioCustomers person={person} upto={upto} me={selfId ?? person} />
          <Note>
            This year and Last year are invoiced revenue out of the uploads, to the
            same day last year, so a part finished month is compared with a part
            finished month. Open is what is still being worked with them and is not
            revenue: it is an estimate of deals nobody has won yet. Sorting orders one
            of those four columns, and the heading it is ordering is shown darker.
          </Note>
        </Panel>

        <MoverPanel
          title="Biggest gainers"
          hint={side === 'both'
            ? 'Customers in this portfolio spending more than the same point last year'
            : `${SIDE_LABEL[side]} only, against the same point last year`}
          rows={gainers}
          loading={loading}
          side={side}
          onSide={(v) => { setSide(v); writeChoice('portfolio-mover-side', v); }}
          up
        />
        <MoverPanel
          title="Biggest fallers"
          hint={side === 'both'
            ? 'Customers in this portfolio spending less than the same point last year'
            : `${SIDE_LABEL[side]} only, against the same point last year`}
          rows={fallers}
          loading={loading}
          side={side}
          onSide={(v) => { setSide(v); writeChoice('portfolio-mover-side', v); }}
        />
      </PanelGrid>

      {deals && (
        <PortfolioDeals
          person={person}
          type={deals.type}
          typeLabel={deals.label}
          state={deals.state}
          upto={upto}
          onClose={() => setDeals(null)}
        />
      )}

      {breakdown && revYear && (
        <PortfolioChange
          person={person}
          upto={upto}
          headline={Number(revYear.change)}
          thisYear={Number(revYear.this_year)}
          lastYear={Number(revYear.last_year)}
          onClose={() => setBreakdown(false)}
        />
      )}
    </div>
  );
}

/* One panel, drawn twice, because a gainer and a faller are the same
   row read from opposite ends.

   The division buttons are on both, and pressing one on either moves
   both, because a gainer in maintenance and a faller in maintenance are
   two ends of one question. Two switches that could disagree would be
   two questions. */
function MoverPanel({ title, hint, rows, loading, side, onSide, up = false }: {
  title: string; hint: string; rows: Mover[]; loading: boolean;
  side: MoverSide; onSide: (v: MoverSide) => void; up?: boolean;
}) {
  return (
    <Panel
      span={6}
      title={title}
      hint={hint}
      table={{
        columns: ['This year', 'Last year', 'Change'],
        rows: rows.map((m) => ({
          name: m.company_name ?? 'Unnamed',
          cells: [
            money(Number(m.this_year)),
            money(Number(m.last_year)),
            `${Number(m.change) > 0 ? '+' : ''}${money(Number(m.change))}`,
          ],
        })),
      }}
    >
      {/* Maintenance, rentals, or both. Asked for by name. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '9px 14px', borderBottom: '1px solid var(--border)',
      }}>
        {MOVER_SIDES.map((v) => (
          <Chip
            key={v}
            active={side === v}
            onClick={() => onSide(v)}
          >{SIDE_LABEL[v]}</Chip>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          what={loading ? 'Reading the invoices' : `No ${up ? 'gainers' : 'fallers'} to show`}
          why={loading
            ? 'One moment.'
            : side === 'both'
              ? 'Nobody in this portfolio has moved, or none of them are bound to Protean yet.'
              : `Nobody in this portfolio has moved on ${SIDE_LABEL[side].toLowerCase()}. Try Both.`}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((m) => (
            <Link
              key={m.contact_id}
              href={`/dashboard/crm?contact=${m.contact_id}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px', textDecoration: 'none', color: 'inherit',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {up ? <TrendingUp size={13} color="var(--success)" />
                : <TrendingDown size={13} color="var(--danger)" />}
              <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.company_name ?? 'Unnamed'}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {money(Number(m.last_year))} &#8594; {money(Number(m.this_year))}
              </span>
              <strong style={{
                fontSize: 13, fontVariantNumeric: 'tabular-nums',
                color: up ? 'var(--success)' : 'var(--danger)', minWidth: 74, textAlign: 'right',
              }}>
                {Number(m.change) > 0 ? '+' : ''}{money(Number(m.change))}
              </strong>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
