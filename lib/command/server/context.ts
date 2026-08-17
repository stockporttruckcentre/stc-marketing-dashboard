/* =============================================================
   Reading the screen's context off a request.

   Everything a browser sends is a request from an untrusted party, and
   this is a request saying "these are the records I am pointing at". It
   is read into the shape this application declares, with a ceiling on
   how many ids one sentence may carry, and every id in it is read back
   through the caller's own session before anything is done with it.

   That last part is not done here. It is what makes this safe rather
   than what makes it clean: the ids become a condition over `id`, the
   condition goes through the same store every other selection goes
   through, and row level security decides what comes back. An id
   somebody guessed narrows to nothing.
   ============================================================= */
import { ENTITIES } from '../schema';
import { EMPTY_CONTEXT, type CommandContext } from '../context';

/** How many records one sentence may point at. */
const MAX_SELECTION = 500;

const KNOWN = new Set(ENTITIES.map((e) => e.id));

/** A UUID, which is what every id in this database is. */
const isId = (v: unknown): v is string =>
  typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function readContext(raw: unknown): CommandContext {
  if (!raw || typeof raw !== 'object') return EMPTY_CONTEXT;
  const body = raw as {
    record?: { entity?: unknown; id?: unknown; label?: unknown };
    selection?: { entity?: unknown; ids?: unknown };
  };

  const out: CommandContext = {};

  const recordEntity = String(body.record?.entity ?? '');
  if (KNOWN.has(recordEntity) && isId(body.record?.id)) {
    out.record = {
      entity: recordEntity,
      id: String(body.record?.id),
      label: typeof body.record?.label === 'string' ? body.record.label : undefined,
    };
  }

  const selectionEntity = String(body.selection?.entity ?? '');
  if (KNOWN.has(selectionEntity) && Array.isArray(body.selection?.ids)) {
    const ids = (body.selection?.ids as unknown[]).filter(isId).map(String);
    if (ids.length) out.selection = { entity: selectionEntity, ids: ids.slice(0, MAX_SELECTION) };
  }

  return out;
}
