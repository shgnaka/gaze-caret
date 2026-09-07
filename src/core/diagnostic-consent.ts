export const DATA_KINDS = ['basic', 'detail', 'landmarks', 'features', 'gaze', 'image', 'video'] as const;
export type DiagnosticDataKind = (typeof DATA_KINDS)[number];

export interface DiagnosticPermission {
  capture: boolean;
  upload: boolean;
  aiRead: boolean;
}

export type DiagnosticConsent = {
  schemaVersion: 1;
  policyVersion: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  permissions: Record<DiagnosticDataKind, DiagnosticPermission>;
};

export type DiagnosticConsentErrorCode = 'invalid-permission' | 'permission-dependency' | 'stale-revision';

export class DiagnosticConsentError extends Error {
  readonly code: DiagnosticConsentErrorCode;

  constructor(code: DiagnosticConsentErrorCode, message: string) {
    super(message);
    this.name = 'DiagnosticConsentError';
    this.code = code;
  }
}

export interface UpdateDiagnosticConsentOptions {
  at: string;
  expectedRevision: number;
}

export type DiagnosticPermissionPatch = Partial<DiagnosticPermission>;

const defaultPermission = (): DiagnosticPermission => ({ capture: false, upload: false, aiRead: false });

function clonePermissions(input: Record<DiagnosticDataKind, DiagnosticPermission>): Record<DiagnosticDataKind, DiagnosticPermission> {
  return Object.fromEntries(DATA_KINDS.map(kind => [kind, { ...input[kind] }])) as Record<DiagnosticDataKind, DiagnosticPermission>;
}

function isDataKind(value: string): value is DiagnosticDataKind {
  return (DATA_KINDS as readonly string[]).includes(value);
}

function assertTimestamp(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) {
    throw new DiagnosticConsentError('invalid-permission', 'Consent timestamps must be short non-empty strings.');
  }
}

function assertPermissionPatch(patch: DiagnosticPermissionPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!['capture', 'upload', 'aiRead'].includes(key) || typeof value !== 'boolean') {
      throw new DiagnosticConsentError('invalid-permission', 'Consent permissions must be boolean values.');
    }
  }
}

function assertDependencies(permission: DiagnosticPermission): void {
  if (permission.upload && !permission.capture) {
    throw new DiagnosticConsentError('permission-dependency', 'Upload permission requires capture permission.');
  }
  if (permission.aiRead && !permission.upload) {
    throw new DiagnosticConsentError('permission-dependency', 'AI read permission requires upload permission.');
  }
}

export function createDefaultDiagnosticConsent(
  at: string,
  policyVersion = 'diagnostics-v2',
): DiagnosticConsent {
  assertTimestamp(at);
  if (!policyVersion || policyVersion.length > 64) {
    throw new DiagnosticConsentError('invalid-permission', 'Consent policy version must be a short non-empty string.');
  }
  const permissions = Object.fromEntries(DATA_KINDS.map(kind => [kind, defaultPermission()])) as Record<DiagnosticDataKind, DiagnosticPermission>;
  permissions.basic.capture = true;
  return {
    schemaVersion: 1,
    policyVersion,
    revision: 0,
    createdAt: at,
    updatedAt: at,
    permissions,
  };
}

export function canCapture(consent: DiagnosticConsent, kind: DiagnosticDataKind): boolean {
  return consent.permissions[kind].capture;
}

export function canUpload(consent: DiagnosticConsent, kind: DiagnosticDataKind): boolean {
  return consent.permissions[kind].upload;
}

export function canAiRead(consent: DiagnosticConsent, kind: DiagnosticDataKind): boolean {
  return consent.permissions[kind].aiRead;
}

export function updateDiagnosticConsent(
  consent: DiagnosticConsent,
  kind: DiagnosticDataKind,
  patch: DiagnosticPermissionPatch,
  options: UpdateDiagnosticConsentOptions,
): DiagnosticConsent {
  if (!isDataKind(kind)) {
    throw new DiagnosticConsentError('invalid-permission', 'Unknown diagnostic data kind.');
  }
  assertTimestamp(options.at);
  assertPermissionPatch(patch);
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision !== consent.revision) {
    throw new DiagnosticConsentError('stale-revision', 'Consent revision is stale.');
  }

  const permission: DiagnosticPermission = { ...consent.permissions[kind], ...patch };
  if (patch.upload === true && !permission.capture) {
    throw new DiagnosticConsentError('permission-dependency', 'Upload permission requires capture permission.');
  }
  if (patch.aiRead === true && (!permission.capture || !permission.upload)) {
    throw new DiagnosticConsentError('permission-dependency', 'AI read permission requires capture and upload permission.');
  }
  // Revocation propagates down the dependency chain. Granting never propagates
  // upward, so a caller must explicitly consent to every wider data flow.
  if (permission.capture === false) {
    permission.upload = false;
    permission.aiRead = false;
  } else if (permission.upload === false) {
    permission.aiRead = false;
  }
  assertDependencies(permission);

  return {
    ...consent,
    revision: consent.revision + 1,
    updatedAt: options.at,
    permissions: {
      ...clonePermissions(consent.permissions),
      [kind]: permission,
    },
  };
}
