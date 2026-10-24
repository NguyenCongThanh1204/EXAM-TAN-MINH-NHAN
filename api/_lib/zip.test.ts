import { ZipArchive } from 'archiver';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { appendZipEntry } from './zip.js';

describe('appendZipEntry', () => {
  it('appends multiple entries in order and creates a ZIP stream', async () => {
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.pipe(output);

    await appendZipEntry(archive, Buffer.from('workbook'), 'results.xlsx');
    await appendZipEntry(archive, Buffer.from('review'), 'pdfs/review.pdf');
    const finished = new Promise<void>((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
    });
    await Promise.all([archive.finalize(), finished]);

    const zip = Buffer.concat(chunks);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(zip.includes(Buffer.from('results.xlsx'))).toBe(true);
    expect(zip.includes(Buffer.from('pdfs/review.pdf'))).toBe(true);
  });
});
