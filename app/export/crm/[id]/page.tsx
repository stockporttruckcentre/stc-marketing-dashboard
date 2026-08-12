import { notFound } from 'next/navigation';
import { loadExportModel } from '@/lib/crm/load-export';
import { ExportView } from '@/components/crm/ExportView';

export const dynamic = 'force-dynamic';

/**
 * Opened in a new tab from the contact drawer, so the CRM stays where it
 * was. Everything the reader needs is on screen; the toolbar turns the
 * same record into the format they actually want.
 */
export default async function ExportPage({ params }: { params: { id: string } }) {
  const model = await loadExportModel(params.id);
  if (!model) notFound();
  return <ExportView model={model} contactId={params.id} />;
}
