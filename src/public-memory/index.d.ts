import type { JsonObject } from "../index.js";
import type { RedactionFilter, ViewerIdentityHasher } from "../public-safety/index.js";

export type PublicMemoryDrawer =
  | "private_long_term"
  | "private_user"
  | "public_long_term"
  | "public_stream_log";

export interface PublicMemoryEntry {
  readonly id: string;
  readonly kind: PublicMemoryDrawer;
  readonly text: string;
  readonly tags: readonly string[];
  readonly actorHash: string | null;
  readonly platform: string | null;
  readonly surface: string | null;
  readonly streamSessionId: string | null;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly approvedBy: string | null;
}

export interface PublicMemoryBank {
  readonly id: string;
  readonly kind: PublicMemoryDrawer;
  append(entry: Partial<PublicMemoryEntry>): PublicMemoryEntry;
  remove(predicate: (entry: PublicMemoryEntry) => boolean): number;
  list(filter?: {
    readonly actorHash?: string;
    readonly platform?: string;
    readonly streamSessionId?: string;
    readonly tag?: string;
    readonly since?: string;
  }): readonly PublicMemoryEntry[];
  snapshot(): {
    readonly id: string;
    readonly kind: PublicMemoryDrawer;
    readonly size: number;
    readonly maxEntries: number;
  };
}

export function createInMemoryPublicMemoryBank(input: {
  readonly id: string;
  readonly kind: PublicMemoryDrawer;
  readonly maxEntries?: number;
}): PublicMemoryBank;

export interface PublicMemoryRecall {
  readonly publicLongTerm: readonly PublicMemoryEntry[];
  readonly publicStreamLog: readonly PublicMemoryEntry[];
  readonly privateLongTerm: readonly never[];
  readonly privateUser: readonly never[];
  readonly drawers: {
    readonly private_long_term: "closed";
    readonly private_user: "closed";
    readonly public_long_term: "open";
    readonly public_stream_log: "open";
  };
}

export interface PublicMemoryFacade {
  recordStreamTurn(input: {
    readonly surface?: string | null;
    readonly platform?: string | null;
    readonly streamSessionId?: string | null;
    readonly actor?: { readonly platform?: string; readonly platformUserId?: string } | null;
    readonly text: string;
    readonly tags?: readonly string[];
    readonly metadata?: JsonObject;
  }): PublicMemoryEntry;
  promoteToLongTerm(input: {
    readonly entryId?: string;
    readonly approvedBy: string;
    readonly text: string;
    readonly tags?: readonly string[];
    readonly metadata?: JsonObject;
  }): PublicMemoryEntry;
  forgetActor(actorHash: string): number;
  recallForBrain(input?: {
    readonly surface?: string | null;
    readonly platform?: string | null;
    readonly streamSessionId?: string | null;
    readonly actor?: { readonly platform?: string; readonly platformUserId?: string } | null;
    readonly limit?: number;
  }): PublicMemoryRecall;
  snapshot(): {
    readonly publicLongTerm: ReturnType<PublicMemoryBank["snapshot"]>;
    readonly publicStreamLog: ReturnType<PublicMemoryBank["snapshot"]>;
    readonly privateDrawersClosed: true;
    readonly approvalRequired: boolean;
  };
}

export function createPublicMemoryFacade(input?: {
  readonly publicLongTerm?: PublicMemoryBank;
  readonly publicStreamLog?: PublicMemoryBank;
  readonly redactionFilter?: RedactionFilter | null;
  readonly viewerIdentityHasher?: ViewerIdentityHasher | null;
  readonly approvalRequired?: boolean;
  readonly onPromotion?: ((event: {
    readonly entryId: string | null;
    readonly promotion: PublicMemoryEntry;
  }) => void) | null;
}): PublicMemoryFacade;

export const publicMemoryConstants: {
  readonly drawers: {
    readonly privateLongTerm: "private_long_term";
    readonly privateUser: "private_user";
    readonly publicLongTerm: "public_long_term";
    readonly publicStreamLog: "public_stream_log";
  };
};
