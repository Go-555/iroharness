export interface SkillManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: string;
  readonly prefix: string;
  readonly purpose: string;
  readonly trigger: string;
  readonly shape: string;
  readonly role: string;
  readonly description: string;
  readonly userInvocable: boolean;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly references: readonly string[];
  readonly evaluator: string | null;
  readonly implementation: Record<string, string>;
  readonly metadata: SkillJsonObject;
}

export interface SkillRegistrySnapshot {
  readonly path: string | null;
  readonly skillDirs: readonly string[];
  readonly skills: readonly SkillManifest[];
}

export interface SkillRegistry {
  readonly path: string | null;
  snapshot(): SkillRegistrySnapshot;
  list(): readonly SkillManifest[];
  get(id: string): SkillManifest | null;
  register(skill: Partial<SkillManifest> & { readonly id: string }): SkillManifest;
}

export interface StackChanAvatarPackPlan {
  readonly skillId: "run-stackchan-avatar-pack";
  readonly evaluator: "eval-stackchan-avatar-pack";
  readonly packId: string;
  readonly characterName: string;
  readonly referenceImage: string;
  readonly outputDir: string;
  readonly avatarDir: string;
  readonly previewPath: string;
  readonly direction: string;
  readonly requiredFiles: readonly string[];
  readonly phases: readonly {
    readonly id: string;
    readonly owner: string;
    readonly done: string;
  }[];
}

export interface StackChanAvatarPackEvaluation {
  readonly ok: boolean;
  readonly packDir: string;
  readonly avatarDir: string;
  readonly requiredFiles: readonly string[];
  readonly checks: readonly {
    readonly id: string;
    readonly ok: boolean;
    readonly file: string;
    readonly path: string;
    readonly detail: string;
  }[];
}

export const stackChanAvatarPackSpec: {
  readonly requiredFiles: readonly string[];
  readonly mouthOverlays: readonly string[];
  readonly width: 320;
  readonly height: 240;
};

export function builtInSkillManifests(): readonly SkillManifest[];
export function defaultBuiltInSkillDir(): string;
export function defaultIroHarnessSkillDir(): string;
export function createFileSkillRegistry(input: {
  readonly path?: string | null;
  readonly skillDirs?: readonly string[];
  readonly builtIns?: readonly SkillManifest[];
}): SkillRegistry;
export function parseSkillFrontmatter(markdown: string): {
  readonly frontmatter: SkillJsonObject;
  readonly body: string;
};
export function createSkillContextListing(input: {
  readonly skills: readonly SkillManifest[];
}): readonly {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly userInvocable: boolean;
  readonly argumentHint: SkillJsonValue;
}[];
export function readSkillInvocationContext(input: {
  readonly skill: SkillManifest;
}): {
  readonly id: string;
  readonly name: string;
  readonly frontmatter: SkillJsonObject;
  readonly body: string;
  readonly execution: {
    readonly context: SkillJsonValue;
    readonly fork: boolean;
    readonly agent: SkillJsonValue;
    readonly model: SkillJsonValue;
    readonly allowedTools: readonly SkillJsonValue[];
  };
  readonly skillDir: SkillJsonValue;
  readonly resources: readonly {
    readonly name: string;
    readonly path: string;
    readonly type: string;
  }[];
};
export function createStackChanAvatarPackPlan(input: {
  readonly referenceImage: string;
  readonly outputDir?: string;
  readonly packId?: string;
  readonly characterName?: string;
  readonly direction?: string;
}): StackChanAvatarPackPlan;
export function evaluateStackChanAvatarPack(input: {
  readonly packDir: string;
}): StackChanAvatarPackEvaluation;
export type SkillJsonPrimitive = string | number | boolean | null;
export type SkillJsonValue = SkillJsonPrimitive | SkillJsonObject | SkillJsonValue[];
export type SkillJsonObject = { readonly [key: string]: SkillJsonValue };
