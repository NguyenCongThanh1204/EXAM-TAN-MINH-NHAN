import type { Archiver, EntryData } from 'archiver';

export const appendZipEntry = (archive: Archiver, source: Buffer, name: string) =>
  new Promise<void>((resolve, reject) => {
    const onEntry = (entry: EntryData) => {
      if (entry.name !== name) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      archive.off('entry', onEntry);
      archive.off('error', onError);
    };
    archive.on('entry', onEntry);
    archive.once('error', onError);
    archive.append(source, { name });
  });
