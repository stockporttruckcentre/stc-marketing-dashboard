'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function CrmListRestore() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    if (sp.get('list')) return;
    try {
      const id = localStorage.getItem('stc:lastListId');
      if (id) router.replace(`/dashboard/crm?list=${id}`);
    } catch {}
  }, [router, sp]);
  return null;
}
