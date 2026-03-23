/** Generic Anchor IDL shape (supports both v0.x and v0.30+). */
export interface AnchorIdl {
  version: string;
  name: string;
  metadata?: {
    address?: string;
    [key: string]: unknown;
  };
  instructions: AnchorIdlInstruction[];
  accounts?: AnchorIdlAccount[];
  types?: AnchorIdlTypeDef[];
  events?: unknown[];
  errors?: unknown[];
  [key: string]: unknown;
}

export interface AnchorIdlInstruction {
  name: string;
  discriminator?: number[];
  accounts: AnchorIdlInstructionAccount[];
  args: AnchorIdlField[];
  [key: string]: unknown;
}

export interface AnchorIdlInstructionAccount {
  name: string;
  isMut?: boolean;
  isSigner?: boolean;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  [key: string]: unknown;
}

export interface AnchorIdlField {
  name: string;
  type: AnchorIdlType;
}

export type AnchorIdlType =
  | string
  | { vec: AnchorIdlType }
  | { option: AnchorIdlType }
  | { array: [AnchorIdlType, number] }
  | { defined: string | { name: string } }
  | { [key: string]: unknown };

export interface AnchorIdlAccount {
  name: string;
  discriminator?: number[];
  type?: {
    kind: string;
    fields?: AnchorIdlField[];
  };
}

export interface AnchorIdlTypeDef {
  name: string;
  type: {
    kind: string;
    fields?: AnchorIdlField[];
    variants?: { name: string; fields?: AnchorIdlField[] }[];
  };
}

/** Interface for IDL sources. */
export interface IdlSource {
  load(): Promise<AnchorIdl>;
}
