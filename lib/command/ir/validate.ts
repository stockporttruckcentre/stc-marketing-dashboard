/* =============================================================
   Checks that run before anything touches data.

   A plan arrives as data. It may have been built by a reader here, or
   posted by a client, and neither is trusted. Everything below is
   structural: it needs no database, so it runs at plan time, again
   before preview, and again before execution.

   THE DATAFLOW CHECK IS THE POINT OF THIS FILE.

   `steps: Step[]` on its own gives sequence and nothing else, and a
   `ResultRef` that names a step producing the wrong SHAPE is the
   failure that dataflow introduces. A step producing a rowset consumed
   where a single record is required is not a runtime error to discover
   later: it is a malformed plan, and it is caught here.

   The five rules:

     1  every ResultRef names a step that exists
     2  that step comes EARLIER, so there are no cycles
     3  that step PRODUCES the referenced shape, where "produces" is
        derived from the step itself, not read off what it claims
     4  the consuming position accepts that shape
     5  the entity matches, so rows of contacts cannot be fed to a
        mutation targeting trailers

   Rule 3 used to read the step's own `produces` field. That made the
   whole check circular: a client posting
   `{op:'select', from:{entity:'contacts'}, produces:{kind:'record'}}`
   was believed, and every downstream guarantee rested on the claim
   being honest. The output contract is now derived here, the claim is
   checked against it, and a claim that disagrees is fatal.

   Nothing here decides permission. `derivedRequirements` computes what
   a plan touches, and the caller compares that against the actor. The
   plan's own `advisoryRequires` is never consulted.
   ============================================================= */
import type {
  Plan, Step, Select, Mutate, Invoke, Emit, Source, Expr, Cond, Produces,
  ResultRef, ResultRefKind, ProducesKind, StepId, FieldRef, PathRef,
} from './types';
import { isResultRef, isSelect, isEntityRef } from './types';
import {
  entity, field, relationship, capability, destination, FILE_EMIT_CAPABILITY, RELATIONSHIPS,
} from './registry';

export type Problem = {
  /** Where in the plan, as a readable path. */
  at: string;
  what: string;
  /** `fatal` refuses the plan. `unmet` is reportable but runnable. */
  severity: 'fatal' | 'unmet';
};

/* -------------------------------------------------------------
   Which result shapes each consuming position accepts.

   Stated as data rather than as conditions scattered through the
   walker, so adding a step kind means adding a row here.
   ------------------------------------------------------------- */
const ACCEPTS: Record<string, ResultRefKind[]> = {
  /* A source is a set of rows. A single record is a set of one, so it
     is admissible; a scalar, a series or an artefact is not a set of
     records at all. */
  'source': ['rows', 'record'],
  /* An expression wants a single value. */
  'expr': ['scalar', 'field'],
  /* What an emit step renders. A series is the shape a grouped
     aggregate has, and rendering one as a chart or a table is the
     ordinary reason to produce it. */
  'emit.from': ['rows', 'record', 'scalar', 'series', 'artefact'],
  /* What an invoke acts on. */
  'invoke.subject': ['rows', 'record'],
  /* An invoke argument takes anything, since a capability may want a
     rowset (members) or a record (a target) or a value. */
  'invoke.arg': ['rows', 'record', 'scalar', 'field', 'series', 'artefact'],
};

/**
 * Does a step producing `produced` satisfy a reference of kind `wanted`?
 *
 * Exact match, with one widening: a `record` can yield a `field`,
 * because a single row has one value per column.
 *
 * A `field` reference against `rows` is DELIBERATELY illegal. Ten
 * thousand contacts have ten thousand email addresses, and there is no
 * honest single value to hand to an expression that wants one. Allowing
 * it meant "email the address on those" typechecked and then picked
 * whichever row came back first. To get one value out of a set you
 * aggregate it, which is what `agg` is for, and the aggregate says
 * which reduction was intended instead of leaving it to the executor.
 *
 * `rows` never satisfies `record` for the same reason.
 */
function satisfies(produced: ProducesKind, wanted: ResultRefKind): boolean {
  if (wanted === 'field') return produced === 'record';
  return produced === wanted;
}

/** The entity a produced shape is about, where the shape has one. */
function entityOf(p: Produces | undefined): string | undefined {
  if (!p) return undefined;
  if (p.kind === 'rows' || p.kind === 'record' || p.kind === 'series') return p.entity;
  return undefined;
}

function containsAgg(e: Expr): boolean {
  switch (e.kind) {
    case 'agg': return true;
    case 'binary': return containsAgg(e.left) || containsAgg(e.right);
    case 'duration': return containsAgg(e.from) || containsAgg(e.to);
    case 'window': return containsAgg(e.of);
    case 'shift': return containsAgg(e.of);
    case 'case':
      return e.when.some((w) => containsAgg(w.then)) || (e.else ? containsAgg(e.else) : false);
    default: return false;
  }
}

/* ------------------------------------------------------------- */

export function validate(plan: Plan): Problem[] {
  const problems: Problem[] = [];
  const add = (at: string, what: string, severity: Problem['severity'] = 'fatal') =>
    problems.push({ at, what, severity });

  /* =============================================================
     Pass one: the derived output contract for every step.

     Forward only, which is sound because rule 2 forbids a reference to
     a later step. A step's contract can therefore always be settled
     from steps already seen.
     ============================================================= */
  const seen = new Map<StepId, { index: number; produces?: Produces }>();

  const entityOfSource = (src: Source): string | undefined => {
    if (isResultRef(src)) return entityOf(seen.get(src.step)?.produces);
    if (isEntityRef(src)) return src.entity;
    if (isSelect(src)) return entityOf(derive(src));
    return undefined;
  };

  function derive(s: Step): Produces | undefined {
    switch (s.op) {
      case 'select': {
        const sel = s as Select;
        const ent = entityOfSource(sel.from);
        const hasAgg = (sel.select ?? []).some((c) => containsAgg(c.expr));
        const grouped = !!sel.shape?.groupBy?.length || !!sel.shape?.compare;
        /* A grouped or compared aggregate is several keyed numbers.
           Calling it a scalar is how "count by depot" ended up
           consumable anywhere one number was wanted. */
        if (hasAgg && grouped) return ent ? { kind: 'series', entity: ent } : { kind: 'series' };
        if (hasAgg) return { kind: 'scalar' };
        return ent ? { kind: 'rows', entity: ent } : undefined;
      }
      case 'create':
        return { kind: 'record', entity: (s as Mutate).target.entity };
      case 'update': case 'delete':
        /* A bulk write touches a set, and returns the set it touched. */
        return { kind: 'rows', entity: (s as Mutate).target.entity };
      case 'invoke': {
        const v = s as Invoke;
        const cap = capability(v.capability);
        /* Nothing about an invoke step reveals its output. Only the
           registry knows, and a capability that has not declared one
           cannot be chained from. */
        if (!cap?.produces) return undefined;
        if (cap.produces === 'rows' || cap.produces === 'record') {
          /* WHAT IT PRODUCES IS WHAT IT OPERATES ON.

             Not what the sentence named. "Mark the in stock
             curtainsiders as sold" has a subject of trailers and
             produces the deals it sold, which is what a later step
             would be chaining from. Deriving the entity from the
             subject said a sale produces trailers. */
          const ent = cap.entities?.[0] ?? (v.subject ? entityOfSource(v.subject) : undefined);
          return ent ? { kind: cap.produces, entity: ent } : undefined;
        }
        if (cap.produces === 'series') return { kind: 'series' };
        return { kind: cap.produces };
      }
      case 'emit': {
        const e = s as Emit;
        return e.output.kind === 'file' ? { kind: 'artefact' } : undefined;
      }
      default: return undefined;
    }
  }

  plan.steps.forEach((s, i) => {
    const derived = derive(s);

    /* The claim is checked against the derivation, never trusted in
       place of it. */
    if (s.produces) {
      if (!derived) {
        add(`steps[${i}].produces`,
          `declares it produces ${s.produces.kind}, but nothing about this ${s.op} step establishes an output`);
      } else if (s.produces.kind !== derived.kind) {
        add(`steps[${i}].produces`,
          `declares ${s.produces.kind}, but this ${s.op} step produces ${derived.kind}`);
      } else {
        const claimed = entityOf(s.produces);
        const actual = entityOf(derived);
        if (claimed && actual && claimed !== actual) {
          add(`steps[${i}].produces`,
            `declares ${s.produces.kind} of ${claimed}, but this ${s.op} step produces ${derived.kind} of ${actual}`);
        }
      }
    }

    if (!s.id) return;
    if (seen.has(s.id)) add(`steps[${i}]`, `duplicate step id "${s.id}"`);
    seen.set(s.id, { index: i, produces: derived });
  });

  /* =============================================================
     Pass two: references, entities, capabilities.
     ============================================================= */

  type Ctx = { index: number; entity?: string };

  const checkRef = (
    r: ResultRef, at: string, position: keyof typeof ACCEPTS, ctx: Ctx, wantEntity?: string,
  ) => {
    const target = seen.get(r.step);
    if (!target) { add(at, `references step "${r.step}", which does not exist`); return; }
    if (target.index >= ctx.index) {
      add(at, `references step "${r.step}", which does not come earlier`);
      return;
    }
    if (!target.produces) {
      add(at, `step "${r.step}" produces nothing that can be referenced`);
      return;
    }
    const wanted = r.ref;
    if (!satisfies(target.produces.kind, wanted)) {
      add(at, `wants ${wanted}, but step "${r.step}" produces ${target.produces.kind}`);
      return;
    }
    const allowed = ACCEPTS[position] ?? [];
    if (!allowed.includes(wanted)) {
      add(at, `a ${wanted} result cannot be used here; this position accepts ${allowed.join(' or ')}`);
      return;
    }
    /* Shape alone is not enough. Rows of contacts and rows of trailers
       are the same shape and are not interchangeable anywhere. */
    const got = entityOf(target.produces);
    if (wantEntity && got && got !== wantEntity) {
      add(at, `step "${r.step}" produces ${wanted} of ${got}, but ${wantEntity} is required here`);
      return;
    }
    if (wanted === 'field' && got && !field(got, r.field)) {
      add(at, `step "${r.step}" produces ${got}, which has no field "${r.field}"`, 'unmet');
    }
  };

  /* --- walkers --- */
  const walkExpr = (e: Expr, at: string, ctx: Ctx): void => {
    switch (e.kind) {
      case 'result': checkRef(e.of, at, 'expr', ctx); return;
      case 'field': checkFieldRef(e.of, at, ctx); return;
      case 'reference': {
        /* A value that names a row. Checked as a lookup in its OWN
           entity, not in whatever entity the step is over: "the profile
           named Dave" is a question about profiles asked from a step
           about contacts. */
        if (!entity(e.entity)) { add(at, `unknown entity "${e.entity}"`); return; }
        if (!field(e.entity, e.select)) {
          add(at, `${e.entity} has no field "${e.select}" to take a value from`, 'unmet');
        }
        walkCond(e.where, `${at}.where`, { index: ctx.index, entity: e.entity });
        /* A reference that resolves to several rows and takes them all
           is not one value. Whatever it named, it named more than one
           thing, and writing one of them is picking. */
        if (e.onAmbiguity === 'all') {
          add(at, 'a reference that yields every match is not a single value');
        }
        return;
      }
      case 'list':
        if (!e.of.length) add(at, 'a list of values with nothing in it names nothing');
        e.of.forEach((x, i) => walkExpr(x, `${at}[${i}]`, ctx));
        return;
      case 'shift':
        walkExpr(e.of, `${at}.of`, ctx);
        if (!Number.isFinite(e.by.n)) add(`${at}.by`, 'a shift needs a number of units');
        /* Shifting something that is not a date is meaningless, and the
           registry knows which columns are dates. */
        if (e.of.kind === 'field' && !('via' in e.of.of)) {
          const def = field(e.of.of.entity, e.of.of.field);
          if (def && def.kind !== 'date') {
            add(at, `${e.of.of.field} is a ${def.kind}, so it cannot be moved by an interval`);
          }
        }
        return;
      case 'agg':
        if (e.of) walkExpr(e.of, `${at}.of`, ctx);
        if (e.where) walkCond(e.where, `${at}.where`, ctx);
        e.partitionBy?.forEach((p, i) => walkExpr(p, `${at}.partitionBy[${i}]`, ctx));
        return;
      case 'binary':
        walkExpr(e.left, `${at}.left`, ctx); walkExpr(e.right, `${at}.right`, ctx); return;
      case 'duration':
        walkExpr(e.from, `${at}.from`, ctx); walkExpr(e.to, `${at}.to`, ctx); return;
      case 'window':
        walkExpr(e.of, `${at}.of`, ctx);
        e.partitionBy?.forEach((p, i) => walkExpr(p, `${at}.partitionBy[${i}]`, ctx));
        if (e.orderBy) walkExpr(e.orderBy, `${at}.orderBy`, ctx);
        return;
      case 'case':
        e.when.forEach((w, i) => {
          walkCond(w.if, `${at}.when[${i}].if`, ctx);
          walkExpr(w.then, `${at}.when[${i}].then`, ctx);
        });
        if (e.else) walkExpr(e.else, `${at}.else`, ctx);
        return;
      default: return;
    }
  };

  const walkCond = (c: Cond, at: string, ctx: Ctx): void => {
    switch (c.kind) {
      case 'cmp':
        walkExpr(c.left, `${at}.left`, ctx); walkExpr(c.right, `${at}.right`, ctx); return;
      case 'between':
        walkExpr(c.of, `${at}.of`, ctx);
        walkExpr(c.from, `${at}.from`, ctx); walkExpr(c.to, `${at}.to`, ctx); return;
      case 'in':
        walkExpr(c.of, `${at}.of`, ctx);
        if (isResultRef(c.values as ResultRef)) checkRef(c.values as ResultRef, `${at}.values`, 'source', ctx);
        else if (Array.isArray(c.values)) c.values.forEach((v, i) => walkExpr(v, `${at}.values[${i}]`, ctx));
        else walkSource(c.values as Select, `${at}.values`, ctx);
        return;
      case 'empty': walkExpr(c.of, `${at}.of`, ctx); return;
      case 'within': walkExpr(c.of, `${at}.of`, ctx); return;
      case 'near':
        walkExpr(c.of, `${at}.of`, ctx); walkExpr(c.origin, `${at}.origin`, ctx); return;
      case 'related': {
        const rel = relationship(c.via);
        if (!rel) { add(at, `unknown relationship "${c.via}"`); return; }
        if (ctx.entity && rel.from !== ctx.entity) {
          add(at, `relationship "${c.via}" starts at ${rel.from}, not ${ctx.entity}`);
          return;
        }
        /* A value match that could return several rows has to say what
           happens then. The registry type makes "pick one" impossible
           to express, and this refuses a traversal that never declared
           a policy at all. */
        if (rel.join.via === 'match' && !rel.join.onAmbiguity) {
          add(at, `relationship "${c.via}" matches by value and declares no ambiguity policy`);
        }
        if (c.where) walkCond(c.where, `${at}.where`, { ...ctx, entity: rel.to });
        return;
      }
      case 'and': case 'or':
        c.of.forEach((x, i) => walkCond(x, `${at}.${c.kind}[${i}]`, ctx)); return;
      case 'not': walkCond(c.of, `${at}.not`, ctx); return;
      default: return;
    }
  };

  const checkFieldRef = (f: FieldRef | PathRef, at: string, ctx: Ctx) => {
    if ('via' in f) {
      let current = f.entity;
      if (ctx.entity && f.entity !== ctx.entity) {
        add(at, `path starts at ${f.entity}, but this step is over ${ctx.entity}`);
        return;
      }
      for (const step of f.via) {
        const rel = relationship(step);
        if (!rel) { add(at, `unknown relationship "${step}" in path`); return; }
        if (rel.from !== current) {
          add(at, `relationship "${step}" starts at ${rel.from}, not ${current}`);
          return;
        }
        current = rel.to;
      }
      if (!field(current, f.field)) add(at, `${current} has no field "${f.field}"`, 'unmet');
      return;
    }
    if (!entity(f.entity)) { add(at, `unknown entity "${f.entity}"`); return; }
    /* A bare field belongs to the thing the step is over. Reaching a
       different entity without saying how is not a filter, it is a
       join nobody declared. */
    if (ctx.entity && f.entity !== ctx.entity) {
      add(at, `${f.entity}.${f.field} is not reachable from ${ctx.entity} without a relationship`);
      return;
    }
    if (!field(f.entity, f.field)) add(at, `${f.entity} has no field "${f.field}"`, 'unmet');
  };

  const walkSource = (s: Source, at: string, ctx: Ctx, wantEntity?: string): void => {
    if (isResultRef(s)) { checkRef(s, at, 'source', ctx, wantEntity); return; }
    if (isEntityRef(s)) {
      if (!entity(s.entity)) add(at, `unknown entity "${s.entity}"`);
      else if (wantEntity && s.entity !== wantEntity) {
        add(at, `this is a set of ${s.entity}, but ${wantEntity} is required here`);
      }
      return;
    }
    if (isSelect(s)) {
      walkStep(s, at, ctx.index);
      const got = entityOf(derive(s));
      if (wantEntity && got && got !== wantEntity) {
        add(at, `this select yields ${got}, but ${wantEntity} is required here`);
      }
    }
  };

  const walkStep = (s: Step, at: string, index: number): void => {
    switch (s.op) {
      case 'select': {
        const sel = s as Select;
        walkSource(sel.from, `${at}.from`, { index });
        const ctx: Ctx = { index, entity: entityOfSource(sel.from) };
        if (sel.where) walkCond(sel.where, `${at}.where`, ctx);
        sel.select?.forEach((c, i) => walkExpr(c.expr, `${at}.select[${i}]`, ctx));
        sel.shape?.groupBy?.forEach((g, i) => walkExpr(g, `${at}.shape.groupBy[${i}]`, ctx));
        if (sel.shape?.having) walkCond(sel.shape.having, `${at}.shape.having`, ctx);
        sel.shape?.orderBy?.forEach((o, i) => walkExpr(o.by, `${at}.shape.orderBy[${i}]`, ctx));
        if (sel.shape?.compare && 'by' in sel.shape.compare) {
          walkExpr(sel.shape.compare.by, `${at}.shape.compare.by`, ctx);
          sel.shape.compare.values?.forEach((v, i) =>
            walkExpr(v, `${at}.shape.compare.values[${i}]`, ctx));
        }
        return;
      }
      case 'create': case 'update': case 'delete': {
        const m = s as Mutate;
        const target = m.target.entity;
        const ctx: Ctx = { index, entity: target };
        if (!entity(target)) add(`${at}.target`, `unknown entity "${target}"`);
        /* Which rows get written must be rows of the thing being
           written. Shape alone would let a set of contacts choose which
           trailers to update. */
        if (m.match) walkSource(m.match, `${at}.match`, ctx, target);
        if (m.op !== 'create' && !m.match) add(at, `${m.op} with no match would touch every row`);

        /* HOW MANY ROWS THE SENTENCE SAID, not how many matched.
           The type requires this on update and delete; a plan arriving
           as JSON has not been through the type, so it is checked here
           as well. Deciding cardinality from the row count is how a
           sentence naming one customer quietly writes forty. */
        if (m.op !== 'create' && m.expect !== 'one' && m.expect !== 'many') {
          add(at, `${m.op} must say whether the request named one row or many`);
        }
        m.set?.forEach((w, i) => {
          if ('via' in (w.field as PathRef)) {
            add(`${at}.set[${i}].field`, 'a write through a relationship is not expressible');
            return;
          }
          if (w.field.entity !== target) {
            add(`${at}.set[${i}].field`,
              `sets ${w.field.entity}.${w.field.field}, but this ${m.op} targets ${target}`);
            return;
          }
          checkFieldRef(w.field, `${at}.set[${i}].field`, ctx);
          const def = field(w.field.entity, w.field.field);
          if (def && !def.writable) add(`${at}.set[${i}]`, `${w.field.field} is not writable`);

          /* Emptying a column the database declares NOT NULL fails at
             the last moment with a constraint error nobody can act on.
             The registry knows which columns those are, and a column
             nobody has checked reads as not clearable. */
          const clearing = w.to.kind === 'literal' && w.to.value === null;
          if (clearing && def && !def.clearable) {
            add(`${at}.set[${i}]`, `${w.field.field} cannot be emptied`);
          }
          if (w.mode === 'append' && def && def.kind !== 'longtext') {
            add(`${at}.set[${i}]`, `${w.field.field} is a ${def.kind}, so nothing can be appended to it`);
          }
          /* `to` is an Expr, so dataflow into it arrives as
             `{kind:'result'}` and is checked by the expression walker.
             There is no second path to guard. */
          walkExpr(w.to, `${at}.set[${i}].to`, ctx);
        });
        return;
      }
      case 'invoke': {
        const v = s as Invoke;
        const cap = capability(v.capability);
        if (!cap) {
          add(`${at}.capability`, `capability "${v.capability}" is not registered`);
          return;
        }
        /* A capability declares which operation may name it. Naming an
           update capability from an invoke step routes the write around
           the field level gate that update steps go through. */
        if (cap.operates !== 'invoke') {
          add(`${at}.capability`,
            `capability "${v.capability}" operates ${cap.operates}, so an invoke step cannot name it`);
        }
        const subjectEntity = v.subject ? entityOfSource(v.subject) : undefined;
        /* AN OPERATION THAT MAKES SOMETHING ACTS ON NOTHING.

           Writing a social post names the entity it makes, and there is
           no selection behind it. Everything below asks whether the
           records the sentence named can be operated on, which is not a
           question a create has. */
        if (cap.entities?.length && !cap.creates) {
          if (!v.subject) {
            add(at, `capability "${v.capability}" applies to ${cap.entities.join(' or ')} and needs a subject`);
          } else if (!subjectEntity) {
            add(`${at}.subject`,
              `capability "${v.capability}" applies to ${cap.entities.join(' or ')}, and the subject's entity cannot be established`);
          } else if (!cap.entities.includes(subjectEntity) && !reachable(subjectEntity, cap.entities)) {
            /* THE SENTENCE NAMES ONE THING AND THE OPERATION RUNS ON
               ANOTHER, AND THAT IS ORDINARY.

               "Mark all the in stock curtainsiders as sold" names units.
               Selling happens on the deal each unit is being sold on,
               which the registry declares as a key relationship. A
               subject that can reach the capability's entity down a
               declared key is a subject the operation can run from; one
               that can only reach it by matching names is not, because
               performing a sale on the strength of a guessed company
               name is not a thing to do. */
            add(`${at}.subject`,
              `capability "${v.capability}" does not apply to ${subjectEntity}, `
              + `and nothing declares a key from ${subjectEntity} to ${cap.entities.join(' or ')}`);
          }
        }
        if (v.subject) walkSource(v.subject, `${at}.subject`, { index });
        for (const [k, a] of Object.entries(v.args ?? {})) {
          if (isResultRef(a as ResultRef)) checkRef(a as ResultRef, `${at}.args.${k}`, 'invoke.arg', { index });
          else walkExpr(a as Expr, `${at}.args.${k}`, { index });
        }
        return;
      }
      case 'emit': {
        const e = s as Emit;
        const ctx: Ctx = { index };
        if (isResultRef(e.from)) checkRef(e.from, `${at}.from`, 'emit.from', ctx);
        else walkSource(e.from, `${at}.from`, ctx);

        /* WHERE IT GOES DECIDES WHAT IT IS.
           An emit to the screen changes nothing. An emit to an email
           address leaves the company and cannot be recalled. Both were
           one step kind with no declared difference, so neither had a
           requirement to derive and nothing gated either. The registry
           states the difference and this enforces it. */
        const dest = destination(e.to.kind);
        if (!dest) {
          add(`${at}.to`, `unknown destination "${e.to.kind}"`);
        } else if (dest.capability && !e.capability) {
          add(at, `sending this ${dest.label.toLowerCase()} must name the capability that permits it`);
        } else if (dest.capability && e.capability !== dest.capability) {
          add(`${at}.capability`,
            `${e.to.kind} is permitted by "${dest.capability}", not by "${e.capability}"`);
        } else if (!dest.capability && e.capability) {
          add(`${at}.capability`,
            `${e.to.kind} changes nothing and needs no capability, so naming "${e.capability}" claims an effect this step does not have`);
        }

        if (e.capability) {
          const cap = capability(e.capability);
          if (!cap) add(`${at}.capability`, `capability "${e.capability}" is not registered`);
          else if (cap.operates !== 'emit') {
            add(`${at}.capability`,
              `capability "${e.capability}" operates ${cap.operates}, so an emit step cannot name it`);
          } else if (cap.entities?.length) {
            const got = entityOfSource(e.from);
            if (got && !cap.entities.includes(got)) {
              add(`${at}.capability`, `capability "${e.capability}" does not apply to ${got}`);
            }
          }
        }

        /* Who it goes to is part of the plan and is checked like any
           other expression. It is also where a requirement can hide: a
           destination naming a colleague reads that colleague. */
        if (e.to.kind === 'share') {
          if (!e.to.with.length) add(`${at}.to`, 'a share with nobody is not a share');
          e.to.with.forEach((x, i) => walkExpr(x, `${at}.to.with[${i}]`, ctx));
        }
        if (e.to.kind === 'email') {
          if (!e.to.to.length) add(`${at}.to`, 'an email to nobody is not an email');
          e.to.to.forEach((x, i) => walkExpr(x, `${at}.to.to[${i}]`, ctx));
        }
        if (e.to.kind === 'attach') walkSource(e.to.to, `${at}.to.attach`, ctx);
        return;
      }
      default: return;
    }
  };

  plan.steps.forEach((s, i) => walkStep(s, `steps[${i}]`, i));
  if (!plan.steps.length) add('steps', 'a plan with no steps does nothing');

  /* =============================================================
     Pass three: unmet semantics may not produce an outcome.

     "Everything except the sold ones, and archive them" where "except"
     went unread archives the sold ones too. Carrying out the part that
     was understood is the most dangerous option available, because it
     looks like the instruction was carried out.

     The screen is the one exception, and only because the screen can
     show what was not understood next to what was. A spreadsheet in
     somebody's downloads folder and an email in a customer's inbox both
     arrive with no record of the question, so a partial answer there is
     indistinguishable from a complete one. `completion` below is what
     stops even the screen reporting success.
     ============================================================= */
  const unresolved = unresolvedParts(plan, problems);
  if (unresolved.length) {
    for (const [i, s] of plan.steps.entries()) {
      const outcome = effectOf(s);
      if (!outcome) continue;
      add(`steps[${i}]`,
        `this plan would ${outcome} while ${unresolved.length} part(s) of the request went unresolved: `
        + `${unresolved.slice(0, 3).join('; ')}. Ask rather than run the understood part.`);
    }
  }

  return problems;
}

/**
 * What a step would actually do, or null when it would do nothing that
 * outlives the answer.
 */
function effectOf(s: Step): string | null {
  if (s.op === 'create' || s.op === 'update' || s.op === 'delete') {
    return `${s.op} ${(s as Mutate).target.entity}`;
  }
  if (s.op === 'invoke') {
    return capability((s as Invoke).capability)?.idempotent ? null : `invoke ${(s as Invoke).capability}`;
  }
  if (s.op === 'emit') {
    const dest = destination((s as Emit).to.kind);
    /* An unknown destination is not assumed harmless. */
    if (!dest) return `emit to an unknown destination`;
    return dest.allowsUnresolved ? null : `send the result ${dest.label.toLowerCase()}`;
  }
  return null;
}

function unresolvedParts(plan: Plan, problems: Problem[]): string[] {
  return [
    ...plan.unmet.map((u) => `${u.part}: ${u.why}`),
    ...problems.filter((p) => p.severity === 'unmet').map((p) => `${p.at}: ${p.what}`),
  ];
}

export function isRunnable(plan: Plan): boolean {
  return !validate(plan).some((p) => p.severity === 'fatal');
}

/* =============================================================
   Whether running this plan answers the question that was asked.

   Three outcomes, and the middle one is the point. A plan that refuses
   is easy to report. A plan that succeeds is easy to report. A plan
   that ran and answered PART of the request is the one that gets
   reported as though it answered all of it, and that is the failure
   this whole architecture exists to remove.

   `partial` is not a softer `complete`. It carries what went
   unresolved, and it exists so that neither the executor nor the
   interface can describe the result as the command having been carried
   out. On screen that means the unresolved parts are shown with the
   answer. Nowhere else may reach this state at all: the gate above
   refuses a partial plan that would download, share, email or attach.
   ============================================================= */
/**
 * A required input the sentence did not carry.
 *
 * Deterministic and static: the capability declares its inputs, this
 * compares them against the step's args, and nothing is guessed. The
 * `ask` is the question to put to the person, in their words rather
 * than the registry's.
 */
export type MissingInput = {
  key: string;
  label: string;
  ask: string;
  /** Which operation is waiting on it. */
  capability: string;
  /**
   * How the answer goes back into the sentence.
   *
   * `%s` is what they typed. The answer completes the RAW TEXT and the
   * server plans the whole thing again from it. The browser never sends
   * a field and a value for the runtime to trust: it sends a longer
   * sentence, which goes through exactly the path the first one did.
   */
  fills: string;
};

export type Completion =
  | { kind: 'refused'; problems: Problem[] }
  /**
   * Understood, and a required value is missing.
   *
   * Different from `refused` in the way that matters: the operation is
   * known, the records are known, and the only thing between here and
   * carrying it out is a value somebody can supply. "I could not tell
   * what you wanted there" is the wrong answer to "create a LinkedIn
   * post": the right one is "what should it say".
   *
   * Nothing runs in this state. It is a question, not a plan.
   */
  | { kind: 'incomplete'; missing: MissingInput[] }
  | { kind: 'partial'; unresolved: string[] }
  | { kind: 'complete' };

/**
 * How to ask for each kind of thing.
 *
 * By the input's key, so a capability that declares one of these gets
 * a sensible question without anybody writing one. A capability whose
 * question is genuinely its own says so on the input itself: "which
 * address" and "what is the address" are both about an address and
 * only one of them is the right thing to ask somebody making an
 * address the main one.
 */
const ASK: Record<string, string> = {
  content: 'What should it say?',
  place: 'Where should I search?',
  url: 'What is the address?',
  address: 'What is the address?',
  which: 'Which one?',
  list: 'Which list?',
  name: 'What should it be called?',
  role: 'Which role?',
  parent: 'Which should be the main account?',
  who: 'Who?',
  file: 'Attach the file and try again.',
};

/**
 * Required inputs no step supplied.
 *
 * Read off the registry rather than off any reader, so a capability
 * that declares an input gets the question for free and a reader
 * cannot forget to ask. Inputs with a `from` are excluded: those can be
 * answered by the records, and whether they were is a question for
 * resolution rather than for the plan.
 */
export function missingInputs(plan: Plan): MissingInput[] {
  const out: MissingInput[] = [];

  const add = (m: MissingInput) => {
    /* Two steps short of the same thing are one question. */
    if (out.some((x) => x.ask === m.ask)) return;
    out.push(m);
  };

  for (const step of plan.steps) {
    if (step.op !== 'invoke') continue;
    const cap = capability(step.capability);
    if (!cap) continue;

    const args = step.args ?? {};
    const there = (key: string) => args[key] != null;

    /* An input can be required only when another one says so: answering
       an invitation takes no time unless the answer is a counter
       proposal. */
    const wanted = (i: NonNullable<typeof cap.inputs>[number]) => {
      if (i.requiredWhen) {
        const on = args[i.requiredWhen.arg];
        const value = on && typeof on === 'object' && 'kind' in on && on.kind === 'literal'
          ? String((on as { value: unknown }).value) : null;
        return value === i.requiredWhen.is;
      }
      return i.required;
    };

    /* QUESTIONS SEVERAL INPUTS ANSWER BETWEEN THEM.

       A day and a time are one question to a person. Asking for them one
       at a time is the form talking, so a group with more than one part
       missing asks once, and a group with one part missing asks about
       that part in its own words. A group whose members are
       ALTERNATIVES asks only when none of them arrived. */
    const grouped = new Set<string>();
    for (const group of cap.inputGroups ?? []) {
      const members = (cap.inputs ?? []).filter((i) => i.group === group.id);
      if (!members.length) continue;
      for (const m of members) grouped.add(m.key);

      const absent = members.filter((i) => !there(i.key) && (group.oneOf || wanted(i)));
      const asksAsAGroup = group.oneOf
        ? members.every((i) => !there(i.key))
        : absent.length > 1;

      if (asksAsAGroup) {
        add({
          key: group.id,
          label: group.ask,
          ask: group.ask,
          capability: step.capability,
          fills: group.fills ?? '%s',
        });
        continue;
      }
      if (!group.oneOf && absent.length === 1) {
        const one = absent[0];
        add({
          key: one.key,
          label: one.label,
          ask: one.ask ?? ASK[one.key] ?? `What is the ${one.label}?`,
          capability: step.capability,
          fills: one.fills ?? '%s',
        });
      }
    }

    for (const input of cap.inputs ?? []) {
      if (grouped.has(input.key)) continue;
      if (!wanted(input) || input.from || input.derivedFrom) continue;
      if (there(input.key)) continue;
      add({
        key: input.key,
        label: input.label,
        ask: input.ask ?? ASK[input.key] ?? `What is the ${input.label}?`,
        capability: step.capability,
        fills: input.fills ?? '%s',
      });
    }
  }
  return out;
}

export function completedWith(text: string, missing: MissingInput, said: string): string {
  const answer = said.trim();
  if (!answer) return text;
  /* A function replacement, so an answer containing $& or $1 is the
     answer rather than a substitution pattern. */
  return `${text.trim()} ${missing.fills.replace('%s', () => answer)}`
    .replace(/\s+/g, ' ')
    .trim();
}

export function completion(plan: Plan): Completion {
  const problems = validate(plan);
  const fatal = problems.filter((p) => p.severity === 'fatal');
  if (fatal.length) return { kind: 'refused', problems: fatal };
  /* Before `partial`, because a missing required value is a question
     with an answer and an unresolved word is not. */
  const missing = missingInputs(plan);
  if (missing.length) return { kind: 'incomplete', missing };
  const unresolved = unresolvedParts(plan, problems);
  if (unresolved.length) return { kind: 'partial', unresolved };
  return { kind: 'complete' };
}

/* =============================================================
   What a plan actually touches.

   The security boundary. `Plan.advisoryRequires` is never read here:
   this walks the plan and reports what it would need, and the caller
   compares that against the actor's capabilities. Run before
   resolution, before preview and before execution.

   Every reachable entity, field and relationship contributes. A path
   expression that hops from a trailer to its customer is reading
   contacts, and a requirement derived only from the step's own entity
   would have missed it.
   ============================================================= */
export type Requirement = {
  /**
   * Two different questions, which were one field and therefore muddled.
   *
   *   permission  an actor capability from `permissions.ts`, such as
   *               `crm.view`. Answers "is this person allowed".
   *   capability  a registry entry, such as `data.read`. Answers "does
   *               anything in this application actually perform it".
   *
   * A plan can pass the first and fail the second. `rows.email` is a
   * real capability with a real permission behind it and no handler, so
   * a plan that emails a result is permitted and cannot be carried out.
   * Reporting that as available is how a bar starts offering things it
   * cannot do.
   */
  kind: 'permission' | 'capability';
  id: string;
  because: string;
};

/**
 * Can an operation on `wanted` run from a subject of `from`?
 *
 * Only down a declared foreign key. A relationship joined by matching
 * text is a guess, and this is the check that decides whether a business
 * operation may follow it.
 */
function reachable(from: string, wanted: string[]): boolean {
  return RELATIONSHIPS.some(
    (r) => r.from === from && wanted.includes(r.to) && r.join.via === 'key',
  );
}

export function derivedRequirements(plan: Plan): Requirement[] {
  const out: Requirement[] = [];
  const seen = new Set<string>();
  const need = (kind: Requirement['kind'], id: string | undefined, because: string) => {
    if (!id) return;
    const key = `${kind}|${id}|${because}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, id, because });
  };
  /** A registry capability, plus whatever permission it declares. */
  const needCapability = (id: string | undefined, because: string) => {
    if (!id) return;
    need('capability', id, because);
    need('permission', capability(id)?.requires, because);
  };

  const fromEntity = (id: string, because: string) =>
    need('permission', entity(id)?.readRequires, because);

  /** The entity a source names, as far as this pass can tell. */
  const entityNamedBy = (src: Source): string | undefined => {
    if (!src || typeof src !== 'object') return undefined;
    if ('entity' in src) return (src as { entity: string }).entity;
    if ('op' in src && (src as Select).op === 'select') {
      const from = (src as Select).from;
      return from && typeof from === 'object' && 'entity' in from
        ? (from as { entity: string }).entity
        : undefined;
    }
    return undefined;
  };

  const fromPath = (f: FieldRef | PathRef): void => {
    if (!('via' in f)) { fromEntity(f.entity, `reads ${f.entity}`); return; }
    let current = f.entity;
    fromEntity(current, `reads ${current}`);
    for (const step of f.via) {
      const rel = relationship(step);
      if (!rel) return;
      for (const r of rel.requires ?? []) need('permission', r, `traverses ${step}`);
      current = rel.to;
      fromEntity(current, `reads ${current}`);
    }
  };

  const fromExpr = (e: Expr): void => {
    switch (e.kind) {
      case 'field': fromPath(e.of); return;
      case 'reference':
        /* Looking a value up in another table is reading that table. */
        fromEntity(e.entity, `reads ${e.entity}`);
        fromCond(e.where);
        return;
      case 'list': e.of.forEach(fromExpr); return;
      case 'shift': fromExpr(e.of); return;
      case 'agg':
        if (e.of) fromExpr(e.of);
        if (e.where) fromCond(e.where);
        e.partitionBy?.forEach(fromExpr);
        return;
      case 'binary': fromExpr(e.left); fromExpr(e.right); return;
      case 'duration': fromExpr(e.from); fromExpr(e.to); return;
      case 'window':
        fromExpr(e.of); e.partitionBy?.forEach(fromExpr);
        if (e.orderBy) fromExpr(e.orderBy);
        return;
      case 'case':
        e.when.forEach((w) => { fromCond(w.if); fromExpr(w.then); });
        if (e.else) fromExpr(e.else);
        return;
      default: return;
    }
  };

  const fromSource = (s: Source): void => {
    if (isEntityRef(s)) { fromEntity(s.entity, `reads ${s.entity}`); return; }
    if (isSelect(s)) fromStep(s);
  };

  const fromCond = (c: Cond): void => {
    switch (c.kind) {
      case 'related': {
        const rel = relationship(c.via);
        for (const r of rel?.requires ?? []) need('permission', r, `traverses ${c.via}`);
        if (rel) fromEntity(rel.to, `reads ${rel.to}`);
        if (c.where) fromCond(c.where);
        return;
      }
      case 'cmp': fromExpr(c.left); fromExpr(c.right); return;
      case 'between': fromExpr(c.of); fromExpr(c.from); fromExpr(c.to); return;
      case 'in':
        fromExpr(c.of);
        if (Array.isArray(c.values)) c.values.forEach(fromExpr);
        else if (!isResultRef(c.values as ResultRef)) fromSource(c.values as Select);
        return;
      case 'empty': case 'within': fromExpr(c.of); return;
      case 'near': fromExpr(c.of); fromExpr(c.origin); return;
      case 'and': case 'or': c.of.forEach(fromCond); return;
      case 'not': fromCond(c.of); return;
      default: return;
    }
  };

  const fromStep = (s: Step): void => {
    switch (s.op) {
      case 'select': {
        const sel = s as Select;
        fromSource(sel.from);
        if (sel.where) fromCond(sel.where);
        sel.select?.forEach((c) => fromExpr(c.expr));
        sel.shape?.groupBy?.forEach(fromExpr);
        if (sel.shape?.having) fromCond(sel.shape.having);
        sel.shape?.orderBy?.forEach((o) => fromExpr(o.by));
        if (sel.shape?.compare && 'by' in sel.shape.compare) fromExpr(sel.shape.compare.by);
        needCapability('data.read', 'answers a question');
        return;
      }
      case 'create': case 'update': case 'delete': {
        const m = s as Mutate;
        fromEntity(m.target.entity, `writes ${m.target.entity}`);
        if (m.op === 'update') needCapability('record.updateField', `updates ${m.target.entity}`);
        if (m.op === 'create') needCapability('record.create', `creates a ${m.target.entity} record`);
        if (m.op === 'delete') needCapability('record.delete', `deletes from ${m.target.entity}`);

        /* WHAT THE ENTITY SAYS IT TAKES, on top of the generic
           capability for the shape of the step. Creating a customer is
           `crm.create` and deleting one is `crm.delete`, and neither is
           derivable from the columns: a delete writes none. Declared on
           the entity, so an entity that declares nothing cannot be
           created or deleted from a sentence at all. */
        const def = entity(m.target.entity);
        if (m.op === 'create') {
          need('permission', def?.createRequires, `creates a ${m.target.entity} record`);
        }
        if (m.op === 'delete') {
          need('permission', def?.deleteRequires, `deletes from ${m.target.entity}`);
        }
        if (m.match) fromSource(m.match);
        for (const w of m.set ?? []) {
          if ('via' in (w.field as PathRef)) continue;
          const def = field(w.field.entity, w.field.field);
          need('permission', def?.writeRequires, `writes ${w.field.entity}.${w.field.field}`);
          fromExpr(w.to);
        }
        return;
      }
      case 'invoke': {
        const v = s as Invoke;
        needCapability(v.capability, `invokes ${v.capability}`);
        if (v.subject) fromSource(v.subject);
        for (const a of Object.values(v.args ?? {})) {
          if (!isResultRef(a as ResultRef)) fromExpr(a as Expr);
        }
        return;
      }
      case 'emit': {
        const e = s as Emit;
        if (!isResultRef(e.from)) fromSource(e.from);

        /* Building the file and deciding where it goes are two
           permissions. Emailing a spreadsheet of the CRM needs both,
           and deriving only one of them let the other through. */
        if (e.output.kind === 'file') {
          needCapability(FILE_EMIT_CAPABILITY, `puts rows into a ${e.output.format}`);
        }
        const dest = destination(e.to.kind);
        const capId = e.capability ?? dest?.capability;
        if (capId) needCapability(capId, `sends it ${dest?.label.toLowerCase() ?? e.to.kind}`);

        /* WHAT IT TAKES TO ATTACH DEPENDS ON WHAT IT IS ATTACHED TO.

           The database has always derived this from the target table:
           a file on a customer is `crm.edit`, one on a stock unit is
           `stock.edit`. The registry said `crm.edit` flatly, which is
           the same answer only while the roles happen to overlap. A
           stock updater with `stock.edit` and no `crm.edit` may put a
           condition report on a trailer and may not put one on a
           customer, and the derived requirement now says so before the
           database has to. */
        if (e.to.kind === 'attach') {
          const onto = entityNamedBy(e.to.to);
          const def = onto ? entity(onto) : undefined;
          need('permission', def?.attachRequires,
            `attaches it to ${onto ?? 'a record'}`);
        }

        /* The destination is not just a label. Who it goes to and what
           it attaches to are expressions and sources of their own, and
           a requirement that hides in one of them is a requirement
           nobody derived. */
        if (e.to.kind === 'share') e.to.with.forEach(fromExpr);
        if (e.to.kind === 'email') e.to.to.forEach(fromExpr);
        if (e.to.kind === 'attach' && !isResultRef(e.to.to)) fromSource(e.to.to);
        return;
      }
    }
  };

  plan.steps.forEach(fromStep);
  return out;
}

/**
 * Whether this plan must be previewed and explicitly agreed to first.
 *
 * Every write, every capability that says so, and every destination
 * that says so. Emailing a list of customers out of the company is not
 * a read just because no row changed.
 */
export function needsConfirmation(plan: Plan): boolean {
  return plan.steps.some((s) => {
    if (s.op === 'create' || s.op === 'update' || s.op === 'delete') return true;
    if (s.op === 'invoke') return capability((s as Invoke).capability)?.confirm ?? true;
    if (s.op === 'emit') {
      const e = s as Emit;
      const dest = destination(e.to.kind);
      /* An unrecognised destination is confirmed, not waved through. */
      if (!dest) return true;
      return dest.confirm || (e.capability ? capability(e.capability)?.confirm ?? true : false);
    }
    return false;
  });
}
