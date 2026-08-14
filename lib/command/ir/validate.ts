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

   The four rules:

     1  every ResultRef names a step that exists
     2  that step comes EARLIER, so there are no cycles
     3  that step declares it produces the referenced shape
     4  the consuming position accepts that shape

   Rule 4 is why `Produces` is declared rather than inferred. A plan can
   be checked before any row exists.

   Nothing here decides permission. `derivedRequirements` computes what
   a plan touches, and the caller compares that against the actor. The
   plan's own `advisoryRequires` is never consulted.
   ============================================================= */
import type {
  Plan, Step, Select, Mutate, Invoke, Emit, Source, Expr, Cond,
  ResultRef, ResultRefKind, ProducesKind, StepId, FieldRef, PathRef,
} from './types';
import { isResultRef, isSelect, isEntityRef } from './types';
import { entity, field, relationship, capability } from './registry';

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
     is admissible; a scalar or an artefact is not a set at all. */
  'source': ['rows', 'record'],
  /* An expression wants a single value. */
  'expr': ['scalar', 'field'],
  /* What a mutation writes into a field. */
  'value': ['scalar', 'field'],
  /* What an emit step renders. */
  'emit.from': ['rows', 'record', 'scalar', 'series' as ResultRefKind],
  /* What an invoke acts on. */
  'invoke.subject': ['rows', 'record'],
  /* An invoke argument takes anything, since a capability may want a
     rowset (members) or a record (a target) or a value. */
  'invoke.arg': ['rows', 'record', 'scalar', 'field', 'artefact'],
};

/** A ResultRef's shape, for comparison against what a step produces. */
function refKind(r: ResultRef): ResultRefKind {
  return r.ref;
}

/**
 * Does a step producing `produced` satisfy a reference of kind `wanted`?
 *
 * `field` and `scalar` both denote one value, and a `record` can yield
 * a `field`, so those are the only widenings allowed. Everything else
 * must match exactly. In particular `rows` never satisfies `record`:
 * that is precisely the "silently took the first one" failure.
 */
function satisfies(produced: ProducesKind, wanted: ResultRefKind): boolean {
  if (wanted === 'field') return produced === 'record' || produced === 'rows';
  if (wanted === 'scalar') return produced === 'scalar';
  if (wanted === 'rows') return produced === 'rows';
  if (wanted === 'record') return produced === 'record';
  if (wanted === 'artefact') return produced === 'artefact';
  return false;
}

/* ------------------------------------------------------------- */

export function validate(plan: Plan): Problem[] {
  const problems: Problem[] = [];
  const add = (at: string, what: string, severity: Problem['severity'] = 'fatal') =>
    problems.push({ at, what, severity });

  /* --- step identity --- */
  const seen = new Map<StepId, { index: number; produces?: ProducesKind }>();
  plan.steps.forEach((s, i) => {
    if (!s.id) return;
    if (seen.has(s.id)) add(`steps[${i}]`, `duplicate step id "${s.id}"`);
    seen.set(s.id, { index: i, produces: s.produces?.kind });
  });

  /* --- the dataflow check --- */
  const checkRef = (r: ResultRef, at: string, position: keyof typeof ACCEPTS, index: number) => {
    const target = seen.get(r.step);
    if (!target) { add(at, `references step "${r.step}", which does not exist`); return; }
    if (target.index >= index) {
      add(at, `references step "${r.step}", which does not come earlier`);
      return;
    }
    if (!target.produces) {
      add(at, `step "${r.step}" does not declare what it produces`);
      return;
    }
    const wanted = refKind(r);
    if (!satisfies(target.produces, wanted)) {
      add(at, `wants ${wanted}, but step "${r.step}" produces ${target.produces}`);
      return;
    }
    const allowed = ACCEPTS[position] ?? [];
    if (!allowed.includes(wanted)) {
      add(at, `a ${wanted} result cannot be used here; this position accepts ${allowed.join(' or ')}`);
    }
  };

  /* --- walkers --- */
  const walkExpr = (e: Expr, at: string, index: number): void => {
    switch (e.kind) {
      case 'result': checkRef(e.of, at, 'expr', index); return;
      case 'field': checkFieldRef(e.of, at); return;
      case 'agg':
        if (e.of) walkExpr(e.of, `${at}.of`, index);
        if (e.where) walkCond(e.where, `${at}.where`, index);
        e.partitionBy?.forEach((p, i) => walkExpr(p, `${at}.partitionBy[${i}]`, index));
        return;
      case 'binary':
        walkExpr(e.left, `${at}.left`, index); walkExpr(e.right, `${at}.right`, index); return;
      case 'duration':
        walkExpr(e.from, `${at}.from`, index); walkExpr(e.to, `${at}.to`, index); return;
      case 'window':
        walkExpr(e.of, `${at}.of`, index);
        e.partitionBy?.forEach((p, i) => walkExpr(p, `${at}.partitionBy[${i}]`, index));
        if (e.orderBy) walkExpr(e.orderBy, `${at}.orderBy`, index);
        return;
      case 'case':
        e.when.forEach((w, i) => {
          walkCond(w.if, `${at}.when[${i}].if`, index);
          walkExpr(w.then, `${at}.when[${i}].then`, index);
        });
        if (e.else) walkExpr(e.else, `${at}.else`, index);
        return;
      default: return;
    }
  };

  const walkCond = (c: Cond, at: string, index: number): void => {
    switch (c.kind) {
      case 'cmp':
        walkExpr(c.left, `${at}.left`, index); walkExpr(c.right, `${at}.right`, index); return;
      case 'between':
        walkExpr(c.of, `${at}.of`, index);
        walkExpr(c.from, `${at}.from`, index); walkExpr(c.to, `${at}.to`, index); return;
      case 'in':
        walkExpr(c.of, `${at}.of`, index);
        if (isResultRef(c.values as ResultRef)) checkRef(c.values as ResultRef, `${at}.values`, 'source', index);
        else if (Array.isArray(c.values)) c.values.forEach((v, i) => walkExpr(v, `${at}.values[${i}]`, index));
        else walkSource(c.values as Select, `${at}.values`, index);
        return;
      case 'empty': walkExpr(c.of, `${at}.of`, index); return;
      case 'within': walkExpr(c.of, `${at}.of`, index); return;
      case 'near':
        walkExpr(c.of, `${at}.of`, index); walkExpr(c.origin, `${at}.origin`, index); return;
      case 'related': {
        const rel = relationship(c.via);
        if (!rel) { add(at, `unknown relationship "${c.via}"`); return; }
        /* A value match that could return several rows has to say what
           happens then. The registry type makes "pick one" impossible
           to express, and this refuses a traversal that never declared
           a policy at all. */
        if (rel.join.via === 'match' && !rel.join.onAmbiguity) {
          add(at, `relationship "${c.via}" matches by value and declares no ambiguity policy`);
        }
        if (c.where) walkCond(c.where, `${at}.where`, index);
        return;
      }
      case 'and': case 'or':
        c.of.forEach((x, i) => walkCond(x, `${at}.${c.kind}[${i}]`, index)); return;
      case 'not': walkCond(c.of, `${at}.not`, index); return;
      default: return;
    }
  };

  const checkFieldRef = (f: FieldRef | PathRef, at: string) => {
    if ('via' in f) {
      let current = f.entity;
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
    if (!field(f.entity, f.field)) add(at, `${f.entity} has no field "${f.field}"`, 'unmet');
  };

  const walkSource = (s: Source, at: string, index: number): void => {
    if (isResultRef(s)) { checkRef(s, at, 'source', index); return; }
    if (isEntityRef(s)) {
      if (!entity(s.entity)) add(at, `unknown entity "${s.entity}"`);
      return;
    }
    if (isSelect(s)) walkStep(s, at, index);
  };

  const walkStep = (s: Step, at: string, index: number): void => {
    switch (s.op) {
      case 'select': {
        const sel = s as Select;
        walkSource(sel.from, `${at}.from`, index);
        if (sel.where) walkCond(sel.where, `${at}.where`, index);
        sel.select?.forEach((c, i) => walkExpr(c.expr, `${at}.select[${i}]`, index));
        sel.shape?.groupBy?.forEach((g, i) => walkExpr(g, `${at}.shape.groupBy[${i}]`, index));
        if (sel.shape?.having) walkCond(sel.shape.having, `${at}.shape.having`, index);
        sel.shape?.orderBy?.forEach((o, i) => walkExpr(o.by, `${at}.shape.orderBy[${i}]`, index));
        return;
      }
      case 'create': case 'update': case 'delete': {
        const m = s as Mutate;
        if (!entity(m.target.entity)) add(`${at}.target`, `unknown entity "${m.target.entity}"`);
        if (m.match) walkSource(m.match, `${at}.match`, index);
        if (m.op !== 'create' && !m.match) add(at, `${m.op} with no match would touch every row`);
        m.set?.forEach((w, i) => {
          checkFieldRef(w.field, `${at}.set[${i}].field`);
          const def = field(w.field.entity, w.field.field);
          if (def && !def.writable) add(`${at}.set[${i}]`, `${w.field.field} is not writable`);
          if (isResultRef(w.to as unknown as ResultRef)) {
            checkRef(w.to as unknown as ResultRef, `${at}.set[${i}].to`, 'value', index);
          } else walkExpr(w.to, `${at}.set[${i}].to`, index);
        });
        return;
      }
      case 'invoke': {
        const v = s as Invoke;
        if (!capability(v.capability)) {
          add(`${at}.capability`, `capability "${v.capability}" is not registered`, 'unmet');
        }
        if (v.subject) walkSource(v.subject, `${at}.subject`, index);
        for (const [k, a] of Object.entries(v.args ?? {})) {
          if (isResultRef(a as ResultRef)) checkRef(a as ResultRef, `${at}.args.${k}`, 'invoke.arg', index);
          else walkExpr(a as Expr, `${at}.args.${k}`, index);
        }
        return;
      }
      case 'emit': {
        const e = s as Emit;
        if (isResultRef(e.from)) checkRef(e.from, `${at}.from`, 'emit.from', index);
        else walkSource(e.from, `${at}.from`, index);
        if (e.to.kind === 'share') e.to.with.forEach((x, i) => walkExpr(x, `${at}.to.with[${i}]`, index));
        if (e.to.kind === 'email') e.to.to.forEach((x, i) => walkExpr(x, `${at}.to.to[${i}]`, index));
        if (e.to.kind === 'attach') walkSource(e.to.to, `${at}.to.attach`, index);
        return;
      }
      default: return;
    }
  };

  plan.steps.forEach((s, i) => walkStep(s, `steps[${i}]`, i));
  if (!plan.steps.length) add('steps', 'a plan with no steps does nothing');
  return problems;
}

export function isRunnable(plan: Plan): boolean {
  return !validate(plan).some((p) => p.severity === 'fatal');
}

/* =============================================================
   What a plan actually touches.

   The security boundary. `Plan.advisoryRequires` is never read here:
   this walks the plan and reports what it would need, and the caller
   compares that against the actor's capabilities. Run before
   resolution, before preview and before execution.
   ============================================================= */
export type Requirement = {
  capability: string;
  because: string;
};

export function derivedRequirements(plan: Plan): Requirement[] {
  const out: Requirement[] = [];
  const seen = new Set<string>();
  const need = (cap: string | undefined, because: string) => {
    if (!cap) return;
    const key = `${cap}|${because}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ capability: cap, because });
  };

  const fromSource = (s: Source): void => {
    if (isEntityRef(s)) {
      const e = entity(s.entity);
      need(e?.readRequires, `reads ${s.entity}`);
      return;
    }
    if (isSelect(s)) fromStep(s);
  };

  const fromCond = (c: Cond): void => {
    if (c.kind === 'related') {
      const rel = relationship(c.via);
      for (const r of rel?.requires ?? []) need(r, `traverses ${c.via}`);
      if (c.where) fromCond(c.where);
      return;
    }
    if (c.kind === 'and' || c.kind === 'or') { c.of.forEach(fromCond); return; }
    if (c.kind === 'not') { fromCond(c.of); return; }
  };

  const fromStep = (s: Step): void => {
    switch (s.op) {
      case 'select': {
        const sel = s as Select;
        fromSource(sel.from);
        if (sel.where) fromCond(sel.where);
        need('data.read', 'answers a question');
        return;
      }
      case 'create': case 'update': case 'delete': {
        const m = s as Mutate;
        if (m.match) fromSource(m.match);
        for (const w of m.set ?? []) {
          const def = field(w.field.entity, w.field.field);
          need(def?.writeRequires, `writes ${w.field.entity}.${w.field.field}`);
        }
        return;
      }
      case 'invoke': {
        const v = s as Invoke;
        const cap = capability(v.capability);
        need(cap?.requires, `invokes ${v.capability}`);
        if (v.subject) fromSource(v.subject);
        return;
      }
      case 'emit': {
        const e = s as Emit;
        if (!isResultRef(e.from)) fromSource(e.from);
        return;
      }
    }
  };

  plan.steps.forEach(fromStep);
  return out;
}

/** Every step whose capability declares that a preview is mandatory. */
export function needsConfirmation(plan: Plan): boolean {
  return plan.steps.some((s) => {
    if (s.op === 'create' || s.op === 'update' || s.op === 'delete') return true;
    if (s.op === 'invoke') return capability((s as Invoke).capability)?.confirm ?? true;
    return false;
  });
}
