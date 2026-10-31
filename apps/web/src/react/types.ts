export type ViewName = 'home' | 'matters' | 'chain' | 'compare' | 'worksite' | 'works' | 'search' | 'all' | 'projects' | 'discussion';

export interface SelectionAnchor {
  field: string;
  start: number;
  end: number;
  text: string;
  baseVersion?: number;
}

export interface RouteMemory {
  view: ViewName;
  matterId?: string;
  workId?: string;
  sessionId?: string;
  screen?: string;
  q?: string;
  kind?: string;
  recordId?: string;
  selectedId?: string;
  detailTab?: string;
  includeHistory?: string;
  returnTarget?: RouteMemory;
  anchor?: SelectionAnchor;
  scroll?: Array<{ className: string; top: number }>;
}

export interface StorageInfo {
  location?: string;
  [key: string]: unknown;
}

/** Read-only search projection, not a second persisted content model. */
export interface LibraryRecord {
  id: string;
  kind: string;
  matterId?: string;
  title: string;
  text: string;
  meta?: string;
  before?: string;
  interpretation?: string;
  unconfirmed?: string;
  route: RouteMemory | null;
}

export interface WebStatus {
  state: 'loading' | 'saving' | 'saved' | 'error';
  text: string;
}

export type WorkspaceLoadState = 'loading' | 'ready' | 'empty' | 'recoverable-error' | 'unrecoverable-error';

export interface DialogState {
  type: 'profile' | 'sources' | 'capability' | 'work-context' | 'message' | 'record';
  title: string;
  message?: string;
  capability?: { matterId: string; query: string; source: 'none' | 'zhihu' | 'web'; agent: 'none' | 'codex-native' | 'codex-harness' | 'custom' };
  confirm?: { label: string; action: () => void };
  record?: {
    meta?: string;
    before?: string;
    title?: string;
    text?: string;
    interpretation?: string;
    unconfirmed?: string;
  };
}

/** The reducer/bridge remains JavaScript; this boundary prevents UI code from
 * reaching through the fetch response or guessing a persistence shape. */
export interface WorkspaceSnapshot {
  host: any;
  revision: number;
  storage: StorageInfo | null;
  ready: boolean;
  loadState: WorkspaceLoadState;
  busy: boolean;
  pending: boolean;
  recoveryDraft: {
    revision: number;
    host: any;
    submittedHost?: any;
    authoritativeHost?: any;
    authoritativeRevision?: number;
    headRevision?: number;
    unconfirmedAcknowledgement?: any;
    conflicts?: string[];
    command?: { commandId: string; expectedRevision: number; host: any; operations?: any[] };
  } | null;
  status: WebStatus;
  error: string | null;
  dialog: DialogState | null;
}

export interface RouteNavigationOptions {
  replace?: boolean;
  render?: boolean;
  origin?: RouteMemory;
}
