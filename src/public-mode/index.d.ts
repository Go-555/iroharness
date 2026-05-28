import type { CharacterProfile, JsonObject } from "../index.js";
import type {
  KillSwitch,
  PromptInjectionDetector,
  RedactionFilter,
  SafeFailureGate,
  ViewerIdentityHasher
} from "../public-safety/index.js";
import type {
  PublicMemoryFacade,
  PublicMemoryRecall
} from "../public-memory/index.js";

export interface PublicModeProfile {
  readonly hidePrivateUserMemory: boolean;
  readonly hidePrivateLongTermMemory: boolean;
  readonly enforceRedaction: boolean;
  readonly denyPermissions: readonly string[];
  readonly storeStreamLog: boolean;
  readonly silentOnFailure: boolean;
}

export interface PublicTurn {
  readonly source: string;
  readonly modality?: "text" | "voice";
  readonly text: string;
  readonly surface?: string;
  readonly platform?: string;
  readonly streamSessionId?: string;
  readonly requestedPermission?: string;
  readonly actor?: {
    readonly platform?: string;
    readonly platformUserId?: string;
    readonly displayName?: string;
  };
  readonly metadata?: JsonObject;
}

export interface PublicReply {
  readonly text: string;
  readonly emotion: string;
}

export interface PublicModeResult {
  readonly handled: true;
  readonly replied: boolean;
  readonly reply?: PublicReply;
  readonly reason?: string;
  readonly details?: JsonObject;
  readonly memory?: PublicMemoryRecall["drawers"];
}

export interface PublicModeBrainRequest {
  readonly character: CharacterProfile;
  readonly input: {
    readonly source: string;
    readonly modality: "text" | "voice";
    readonly text: string;
    readonly surface: string | null;
  };
  readonly memory: PublicMemoryRecall;
  readonly mode: "public";
  readonly profile: PublicModeProfile;
  readonly actor: {
    readonly platform: string | null;
    readonly displayName: string | null;
    readonly actorHash: string | null;
  };
}

export interface PublicModeBrain {
  readonly id?: string;
  respond(request: PublicModeBrainRequest): Promise<{
    readonly text?: string;
    readonly emotion?: string;
  }>;
}

export interface PublicMode {
  readonly mode: "public";
  readonly killSwitch: KillSwitch;
  readonly redactionFilter: RedactionFilter;
  readonly publicMemory: PublicMemoryFacade;
  readonly publicCharacter: CharacterProfile;
  readonly profile: PublicModeProfile;
  handleTurn(input: {
    readonly turn: PublicTurn;
    readonly sendReply?: (reply: PublicReply) => Promise<void> | void;
  }): Promise<PublicModeResult>;
  snapshot(): JsonObject;
}

export function createPublicMode(input: {
  readonly character: CharacterProfile;
  readonly brain: PublicModeBrain;
  readonly redactionTerms?: readonly string[];
  readonly redactionReplacement?: string;
  readonly injectionDetector?: PromptInjectionDetector;
  readonly failureGate?: SafeFailureGate;
  readonly killSwitch?: KillSwitch;
  readonly viewerIdentityHasher?: ViewerIdentityHasher;
  readonly publicMemoryFacade?: PublicMemoryFacade | null;
  readonly approvedSurfaces?: readonly string[];
  readonly publicProfile?: Partial<PublicModeProfile>;
  readonly onTurn?: ((event: { readonly turn: PublicTurn }) => void) | null;
  readonly onReply?: ((event: {
    readonly turn: PublicTurn;
    readonly reply: PublicReply;
  }) => void) | null;
  readonly onBlocked?: ((event: {
    readonly turn: PublicTurn | null;
    readonly reason: string;
    readonly details: JsonObject;
  }) => void) | null;
}): PublicMode;

export const publicModeConstants: {
  readonly defaultProfile: PublicModeProfile;
  readonly defaultDenyPermissions: readonly string[];
};
