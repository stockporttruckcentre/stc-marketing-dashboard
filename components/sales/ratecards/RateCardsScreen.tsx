'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RateCardsHub } from './RateCardsHub';
import { RateBuilder } from './RateBuilder';
import { DefaultRates } from './Defaults';
import { Toasts, type Toast } from './modals';
import { writeChoice } from '@/lib/ui/remember';

import './rate-card-tokens.css';
import './rate-card-components.css';
import './port.css';

/* =============================================================
   The Rate Card Builder, all three screens of it.

   Which one is showing is in the address, so a card can be linked to
   from a notification, from the FleetSmart+ builder and from the
   command bar, and so the browser's back button does what it looks
   like it does.

     /dashboard/rate-cards                 the hub
     /dashboard/rate-cards?card=<id>       the builder
     /dashboard/rate-cards?view=defaults   the default rates

   ---- What is remembered ----

   From the standing rule: anything somebody sets about how a screen is
   drawn is remembered and survives a reload. Here that is the hub's
   filter chip, which is per device rather than per account because two
   people at one desk want different ones.
   ============================================================= */

export function RateCardsScreen({ caps }: {
  caps: { view: boolean; build: boolean; labour: boolean; approve: boolean };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const card = params.get('card');
  const view = params.get('view');

  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    /* Ten seconds, which is the window the pack gives an undo. A toast
       with an undo on it that vanishes in three is a toast that lies. */
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.undo ? 10_000 : 4_500);
  }, []);

  const go = useCallback((to: string) => {
    router.push(to, { scroll: false });
  }, [router]);

  /* The theme. The kit switches on `data-stc-theme`; this application
     uses `data-theme`, and `rate-card-tokens.css` is rescoped to answer
     both, so nothing has to be set here. This effect exists only to
     remember where somebody was. */
  useEffect(() => {
    if (card) writeChoice('ratecards.last', card);
  }, [card]);

  if (view === 'defaults') {
    return (
      <>
        <DefaultRates
          caps={caps}
          onToast={toast}
          onBack={() => go('/dashboard/rate-cards')}
        />
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
      </>
    );
  }

  if (card) {
    return (
      <>
        <RateBuilder
          key={card}
          cardId={card}
          caps={caps}
          onToast={toast}
          onBack={() => go('/dashboard/rate-cards')}
        />
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
      </>
    );
  }

  return (
    <>
      <RateCardsHub
        caps={caps}
        onToast={toast}
        onOpen={(id) => go(`/dashboard/rate-cards?card=${id}`)}
        onDefaults={() => go('/dashboard/rate-cards?view=defaults')}
      />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </>
  );
}
