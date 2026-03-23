import type { AnchorIdl } from './types.js';

/**
 * Type mapping from old Anchor IDL format to new 0.30+ format.
 * Old format uses string types like "publicKey", "u64", etc.
 * New format uses object types like { kind: "type_alias" }.
 */
const OLD_TO_NEW_TYPE: Record<string, unknown> = {
  publicKey: 'pubkey',
  // These remain the same in new format
  bool: 'bool',
  u8: 'u8',
  u16: 'u16',
  u32: 'u32',
  u64: 'u64',
  u128: 'u128',
  i8: 'i8',
  i16: 'i16',
  i32: 'i32',
  i64: 'i64',
  i128: 'i128',
  f32: 'f32',
  f64: 'f64',
  string: 'string',
  bytes: 'bytes',
};

/**
 * Adapts an Anchor IDL to be compatible with @coral-xyz/anchor 0.30+ BorshCoder.
 *
 * Changes:
 * 1. Account types merged into `types` array
 * 2. `publicKey` type renamed to `pubkey`
 * 3. Address metadata ensured
 */
export function adaptIdlForCoder(idl: AnchorIdl): AnchorIdl {
  const adapted = JSON.parse(JSON.stringify(idl)) as AnchorIdl;
  const types = adapted.types || [];
  const typeNames = new Set(types.map((t) => t.name));

  // Convert types to new format
  for (const typeDef of types) {
    if (typeDef.type?.fields) {
      typeDef.type.fields = typeDef.type.fields.map(convertField);
    }
    if (typeDef.type?.variants) {
      for (const variant of typeDef.type.variants) {
        if (variant.fields) {
          variant.fields = variant.fields.map(convertField);
        }
      }
    }
  }

  // Ensure each account also exists in types
  if (adapted.accounts) {
    for (const account of adapted.accounts) {
      if (!typeNames.has(account.name) && account.type) {
        const convertedFields = account.type.fields
          ? account.type.fields.map(convertField)
          : [];
        types.push({
          name: account.name,
          type: {
            ...account.type,
            fields: convertedFields,
          } as any,
        });
        typeNames.add(account.name);
      }
    }
  }

  adapted.types = types;

  // Convert instruction arg types
  if (adapted.instructions) {
    for (const ix of adapted.instructions) {
      if (ix.args) {
        ix.args = ix.args.map(convertField);
      }
    }
  }

  // Ensure address field exists (required by newer Anchor)
  if (!adapted.metadata) {
    adapted.metadata = {};
  }
  if (!adapted.metadata.address) {
    adapted.metadata.address = '11111111111111111111111111111111';
  }

  return adapted;
}

function convertField(field: { name: string; type: any }): { name: string; type: any } {
  return {
    name: field.name,
    type: convertType(field.type),
  };
}

function convertType(type: unknown): unknown {
  if (typeof type === 'string') {
    return OLD_TO_NEW_TYPE[type] ?? type;
  }
  if (typeof type === 'object' && type !== null) {
    const obj = type as Record<string, unknown>;
    if ('vec' in obj) return { vec: convertType(obj.vec) };
    if ('option' in obj) return { option: convertType(obj.option) };
    if ('array' in obj) {
      const arr = obj.array as [unknown, number];
      return { array: [convertType(arr[0]), arr[1]] };
    }
    if ('defined' in obj) return obj;
  }
  return type;
}
