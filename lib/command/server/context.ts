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

/**
 * How large a file one request may carry, in characters of text.
 *
 * A spreadsheet of five thousand customers is roughly a megabyte, and
 * five thousand is the ceiling the import itself enforces. Anything past
 * this is refused at the door rather than parsed and then refused, so a
 * request nobody could act on cannot cost the parse.
 */
const MAX_FILE = 4_000_000;

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
    file?: { name?: unknown; mime?: unknown; size?: unknown; text?: unknown };
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

  /* A FILE IS CONTEXT, THE SAME WAY A SELECTION IS.

     The browser is the only place that has it, and nothing about what it
     means is decided here: the text is carried through and the operation
     that reads it does so against the same dictionary the import screen
     uses. A file too large to be an import of this application is
     dropped rather than truncated, because half a spreadsheet is worse
     than none. */
  const text = body.file?.text;
  if (typeof text === 'string' && text.length > 0 && text.length <= MAX_FILE) {
    out.file = {
      name: typeof body.file?.name === 'string' ? body.file.name.slice(0, 200) : 'the file',
      mime: typeof body.file?.mime === 'string' ? body.file.mime.slice(0, 120) : 'text/csv',
      size: typeof body.file?.size === 'number' ? body.file.size : text.length,
      text,
    };
  }

  return out;
}
