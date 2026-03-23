import type { AnchorIdl, AnchorIdlField, AnchorIdlType, AnchorIdlTypeDef } from './types.js';

export interface IdlField {
  name: string;
  type: string; // Simplified type string for metadata
  rawType: AnchorIdlType;
}

export interface NormalizedInstruction {
  name: string;
  discriminator: number[] | null;
  accounts: {
    name: string;
    isMut: boolean;
    isSigner: boolean;
    optional: boolean;
  }[];
  args: IdlField[];
}

export interface NormalizedAccount {
  name: string;
  discriminator: number[] | null;
  fields: IdlField[];
}

export interface NormalizedIdl {
  name: string;
  version: string;
  instructions: NormalizedInstruction[];
  accounts: NormalizedAccount[];
  types: Map<string, AnchorIdlTypeDef>;
  raw: AnchorIdl;
}

/** Normalize an Anchor IDL into a consistent internal structure. */
export function normalizeIdl(idl: AnchorIdl): NormalizedIdl {
  const typesMap = new Map<string, AnchorIdlTypeDef>();
  for (const t of idl.types || []) {
    typesMap.set(t.name, t);
  }

  const instructions = (idl.instructions || []).map((ix): NormalizedInstruction => ({
    name: camelCase(ix.name),
    discriminator: ix.discriminator || null,
    accounts: (ix.accounts || []).map((acc) => ({
      name: camelCase(acc.name),
      isMut: acc.isMut ?? acc.writable ?? false,
      isSigner: acc.isSigner ?? acc.signer ?? false,
      optional: acc.optional ?? false,
    })),
    args: (ix.args || []).map((arg) => normalizeField(arg)),
  }));

  const accounts = normalizeAccounts(idl, typesMap);

  return {
    name: idl.name || (idl.metadata as { name?: string })?.name || 'unknown',
    version: idl.version || '0.0.0',
    instructions,
    accounts,
    types: typesMap,
    raw: idl,
  };
}

function normalizeAccounts(idl: AnchorIdl, typesMap: Map<string, AnchorIdlTypeDef>): NormalizedAccount[] {
  const accounts: NormalizedAccount[] = [];

  // From IDL accounts array
  if (idl.accounts) {
    for (const acc of idl.accounts) {
      const fields = resolveAccountFields(acc.name, acc, typesMap);
      accounts.push({
        name: camelCase(acc.name),
        discriminator: acc.discriminator || null,
        fields,
      });
    }
  }

  return accounts;
}

function resolveAccountFields(
  name: string,
  acc: { type?: { kind: string; fields?: AnchorIdlField[] } },
  typesMap: Map<string, AnchorIdlTypeDef>
): IdlField[] {
  // Direct fields on account
  if (acc.type?.fields) {
    return acc.type.fields.map(normalizeField);
  }

  // Look up in types map
  const typeDef = typesMap.get(name);
  if (typeDef?.type?.fields) {
    return typeDef.type.fields.map(normalizeField);
  }

  return [];
}

function normalizeField(field: AnchorIdlField): IdlField {
  return {
    name: camelCase(field.name),
    type: typeToString(field.type),
    rawType: field.type,
  };
}

/** Convert an Anchor IDL type to a simplified string representation. */
export function typeToString(type: AnchorIdlType): string {
  if (typeof type === 'string') return type;
  if ('vec' in type) return `vec<${typeToString((type as { vec: AnchorIdlType }).vec)}>`;
  if ('option' in type) return `option<${typeToString((type as { option: AnchorIdlType }).option)}>`;
  if ('array' in type) {
    const arr = (type as { array: [AnchorIdlType, number] }).array;
    return `array<${typeToString(arr[0])}, ${arr[1]}>`;
  }
  if ('defined' in type) {
    const d = (type as { defined: string | { name: string } }).defined;
    return `defined<${typeof d === 'string' ? d : d.name}>`;
  }
  return JSON.stringify(type);
}

function camelCase(str: string): string {
  // Handle snake_case and PascalCase, normalize to camelCase
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
