import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildWorkbook } from './export-xlsx';
import type { FullCard } from './types';

/* =============================================================
   The rate card as a PDF, which is the workbook itself.

   From the business, after being sent a PDF that carried the same
   figures in a layout of its own:

     I specifically wrote that currently you are generating a PDF that
     has a design that differs from the xlsx version and to mirror the
     xlsx version, even if it's just a PNG image of it inside a pdf, i
     don't care, it HAS to mirror it as compliance have signed off.

   So nothing here draws anything. The workbook is built, exactly as the
   Excel export builds it, and handed to LibreOffice to convert. What
   comes back is the customer's own file: the master's fonts, its navy
   section bars, its fills, its borders, its merges and its logo, on the
   pages the master prints on.

   ---- What was here before, and why it was wrong ----

   A renderer. It read the same grid the workbook reads and drew it with
   pdf-lib: same cells, same columns, same order, same values, and none
   of the master's fonts, fills, borders, merges or logo. Every figure
   was right and the document was not the one compliance signed off.
   That was a decision nobody asked for, taken because converting needs
   a spreadsheet engine on the server and assuming there was none was
   easier than finding out.

   ---- What this needs ----

   LibreOffice, with Calc, on the machine running the application:

     apt-get install libreoffice-calc

   `libreoffice-core` on its own is not enough. It has no spreadsheet
   filter, so it refuses the file with "source file could not be
   loaded", which is what this container did until Calc was installed.

   If it is not there, this THROWS and the export fails with a message
   saying so. It does not quietly fall back to drawing one. A customer
   receiving a document that does not match the signed off design is
   worse than a customer receiving nothing, because nobody finds out.
   ============================================================= */

/** How long to wait for a conversion before giving up, in milliseconds. */
const TIMEOUT = 60_000;

/** Where LibreOffice lives, overridable for a host that puts it elsewhere. */
const SOFFICE = process.env.SOFFICE_PATH ?? 'soffice';

export class NoConverterError extends Error {
  constructor(why: string) {
    super(
      'The PDF is the Excel rate card converted, and the converter is not available on this '
      + `server. Install LibreOffice Calc (apt-get install libreoffice-calc), or set SOFFICE_PATH. (${why})`,
    );
    this.name = 'NoConverterError';
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; err: string }> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new NoConverterError(e instanceof Error ? e.message : String(e)));
      return;
    }

    let err = '';
    child.stderr?.on('data', (b: Buffer) => { err += b.toString(); });
    child.stdout?.on('data', () => { /* the filter name, which is not interesting */ });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The rate card took longer than ${TIMEOUT / 1000} seconds to convert.`));
    }, TIMEOUT);

    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') reject(new NoConverterError(`${cmd} is not on this machine`));
      else reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, err });
    });
  });
}

/**
 * The rate card as a PDF: the workbook, converted.
 *
 * @throws NoConverterError when LibreOffice Calc is not installed.
 */
export async function buildRateCardPdf(card: FullCard): Promise<Uint8Array> {
  const workbook = await buildWorkbook(card);

  const dir = await mkdtemp(path.join(tmpdir(), 'rate-card-pdf-'));
  try {
    const xlsx = path.join(dir, 'card.xlsx');
    await writeFile(xlsx, Buffer.from(workbook));

    /* A profile of its own per conversion. LibreOffice keeps one user
       profile and refuses to start a second instance against it, so two
       people exporting at the same moment would collide. */
    const profile = path.join(dir, 'profile');

    const { code, err } = await run(SOFFICE, [
      '--headless',
      '--norestore',
      '--invisible',
      '--nolockcheck',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', 'pdf:calc_pdf_Export',
      '--outdir', dir,
      xlsx,
    ], dir);

    const made = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (made.length === 0) {
      /* No spreadsheet filter reads as an ordinary failure on stdout
         rather than as a missing binary, so it is named here. */
      if (err.includes('source file could not be loaded')) {
        throw new NoConverterError('LibreOffice is installed without Calc, so it cannot open a spreadsheet');
      }
      throw new Error(`The rate card would not convert (exit ${code}). ${err.trim().slice(0, 300)}`);
    }

    return new Uint8Array(await readFile(path.join(dir, made[0]!)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
