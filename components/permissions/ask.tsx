'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, Check, Loader } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/kit/primitives';

/* =============================================================
   What a button does when you may not press it.

   From the business:

     Ensure everything connects to something though - if one role cannot
     export and one can, ensure the button states reflect this across the
     accounts, that one user understand why they don't have access and
     who to contact to perform that task.

     have a hover-over "ask your department lead to run this" for regular
     admin users

   And, asked whether a blocked button should simply grey out or go
   somewhere: "Request it, and Sr gets a decision."

   ---- Why not just hide it ----

   Hiding is right for a whole SCREEN. Somebody who cannot open Analytics
   does not want a row in the sidebar that refuses them. It is wrong for
   an ACTION on a screen they are already using, because the absence
   reads as the feature not existing: a salesperson who cannot find
   Export concludes the CRM cannot export, asks in the office, and
   somebody sends them a spreadsheet by email. The control that is not
   there teaches nothing and routes around itself.

   So an action they may not take is drawn, plainly not available, and
   says who can. The name is a ROLE and never a person: people leave, and
   a button naming somebody who left is worse than one naming nobody.

   ---- Where the answer comes from ----

   `escalation_for` in migration 105, which walks the escalation chain
   from the caller's own role to the first one above them that actually
   holds the capability. It skips a senior who cannot do it either, which
   matters: Sr Sales cannot approve a post, so a salesperson asking about
   one is sent to Business Development rather than to somebody who would
   have to refuse them.

   It returns nothing at all when the caller already holds the
   capability, so this component renders nothing in that case and the
   real button is drawn instead. Deciding that here rather than at every
   call site is deliberate: `{caps.has(x) ? <Real/> : <Ask/>}` is a line
   somebody can get backwards.
   ============================================================= */

type Escalation = { slug: string; name: string } | null;

type State =
  | { at: 'looking' }
  | { at: 'nobody' }
  | { at: 'can-ask'; role: Escalation }
  | { at: 'asking' }
  | { at: 'asked'; role: Escalation };

export function AskInstead({
  capability, doing, label, size = 'sm',
}: {
  /** The capability the real button needs. */
  capability: string;
  /** What they were trying to do, in their words rather than the key. */
  doing: string;
  /** The real button's own label, so the disabled one reads the same. */
  label: string;
  size?: 'sm' | 'md';
}) {
  const supabase = createClient();
  const [state, setState] = useState<State>({ at: 'looking' });

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ data: up }, { data: open }] = await Promise.all([
        supabase.rpc('escalation_for', { p_capability: capability }),
        supabase.from('capability_requests')
          .select('id').eq('capability', capability).eq('status', 'pending').maybeSingle(),
      ]);
      if (!live) return;
      const role: Escalation = Array.isArray(up) && up.length > 0
        ? { slug: String(up[0].slug), name: String(up[0].name) }
        : null;
      if (open) setState({ at: 'asked', role });
      else if (role) setState({ at: 'can-ask', role });
      else setState({ at: 'nobody' });
    })();
    return () => { live = false; };
  }, [supabase, capability]);

  const ask = useCallback(async () => {
    const role = state.at === 'can-ask' ? state.role : null;
    setState({ at: 'asking' });
    const { error } = await supabase.rpc('request_capability', {
      p_capability: capability, p_doing: doing,
    });
    /* A failure puts the button back rather than swallowing it. The one
       error worth expecting is "you already have that", which happens
       when somebody was granted it in another tab, and putting the
       button back is the right answer to that too: the page is stale
       and a reload draws the real control. */
    setState(error ? { at: 'can-ask', role } : { at: 'asked', role });
  }, [supabase, capability, doing, state]);

  /* Nothing at all while it is being worked out. A button that appears
     a beat later is better than one that changes its mind in front of
     somebody. */
  if (state.at === 'looking') return null;

  if (state.at === 'nobody') {
    return (
      <Button
        size={size}
        variant="secondary"
        disabled
        title={`You do not have access to ${doing.toLowerCase()}, and nobody above you does either.`}
      >
        <Lock size={13} /> {label}
      </Button>
    );
  }

  if (state.at === 'asked') {
    return (
      <Button
        size={size}
        variant="secondary"
        disabled
        title={state.role
          ? `${state.role.name} has been asked. You will get a notification either way.`
          : 'Asked. You will get a notification either way.'}
      >
        <Check size={13} /> Asked{state.role ? ` ${state.role.name}` : ''}
      </Button>
    );
  }

  if (state.at === 'asking') {
    return (
      <Button size={size} variant="secondary" disabled>
        <Loader size={13} className="spin" /> {label}
      </Button>
    );
  }

  return (
    <Button
      size={size}
      variant="secondary"
      onClick={ask}
      title={`Ask your department lead to run this. ${state.role?.name} can, and pressing this asks them.`}
      style={{ opacity: 0.8 }}
    >
      <Lock size={13} /> Ask {state.role?.name}
    </Button>
  );
}

/**
 * The real control, or the ask, decided in one place.
 *
 * `{caps.has(x) ? <Real/> : <Ask/>}` written out at every call site is a
 * line somebody eventually gets backwards, and getting it backwards
 * means offering an action to exactly the people who cannot take it.
 */
export function Gated({
  may, capability, doing, label, size, children,
}: {
  may: boolean;
  capability: string;
  doing: string;
  label: string;
  size?: 'sm' | 'md';
  children: React.ReactNode;
}) {
  if (may) return <>{children}</>;
  return <AskInstead capability={capability} doing={doing} label={label} size={size} />;
}
