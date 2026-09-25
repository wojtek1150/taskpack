import { MAX_IMAGE_BYTES, TaskpackError } from '@taskpack/core';
import busboy from 'busboy';
import type { Request } from 'express';

export interface Upload {
  data: Buffer;
  name: string;
  fields: Record<string, string>;
  /** Repeated fields (`tasks`). */
  lists: Record<string, string[]>;
}

/**
 * Read a `multipart/form-data` request with one file (field `file`) and text fields.
 * Bodies over the 25 MB image limit are refused while streaming.
 */
export function readUpload(req: Request): Promise<Upload> {
  return new Promise((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_IMAGE_BYTES, fields: 20, fieldSize: 4096 },
      });
    } catch {
      reject(new TaskpackError('invalid', 'expected multipart/form-data with a file'));
      return;
    }
    const fields: Record<string, string> = {};
    const lists: Record<string, string[]> = {};
    let file: { data: Buffer; name: string } | undefined;
    let failed: Error | undefined;
    bb.on('file', (field, stream, info) => {
      if (field !== 'file') {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => {
        failed = new TaskpackError('invalid', `file is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
      });
      stream.on('end', () => {
        file = { data: Buffer.concat(chunks), name: info.filename || 'image' };
      });
    });
    bb.on('field', (name, value) => {
      fields[name] = value;
      lists[name] = [...(lists[name] ?? []), value];
    });
    bb.on('error', (err) => reject(new TaskpackError('invalid', `upload failed: ${(err as Error).message}`)));
    bb.on('close', () => {
      if (failed) reject(failed);
      else if (!file) reject(new TaskpackError('invalid', 'no file in the upload (field "file")'));
      else resolve({ ...file, fields, lists });
    });
    req.pipe(bb);
  });
}
