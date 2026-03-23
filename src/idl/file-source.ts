import fs from 'fs/promises';
import path from 'path';
import type { AnchorIdl, IdlSource } from './types.js';

export class FileIdlSource implements IdlSource {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AnchorIdl> {
    const resolved = path.resolve(this.filePath);
    const content = await fs.readFile(resolved, 'utf-8');
    const parsed = JSON.parse(content);
    this.validate(parsed);
    return parsed;
  }

  private validate(obj: unknown): asserts obj is AnchorIdl {
    if (!obj || typeof obj !== 'object') {
      throw new Error('IDL file does not contain a valid JSON object');
    }
    const idl = obj as Record<string, unknown>;
    if (!idl.instructions || !Array.isArray(idl.instructions)) {
      throw new Error('IDL is missing "instructions" array');
    }
    if (typeof idl.name !== 'string' && typeof idl.metadata !== 'object') {
      throw new Error('IDL is missing "name" field');
    }
  }
}
