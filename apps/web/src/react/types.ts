export type ViewName = 'home' | 'matters' | 'chain' | 'compare' | 'worksite' | 'works' | 'search' | 'all' | 'discussion';

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
  returnTarget?: RouteMemory;
  anchor?: SelectionAnchor;
  scroll?: Array<{ className: string; top: number }>;
}

export interface StorageInfo {
  location?: string;
  [key: string]: unknown;
}

export interface WebStatus {
  state: 'loading' | 'saving' | 'saved' | 'error';
  text: string;
}

export interface DialogState {
  type: 'profile' | 'sources' | 'work-context' | 'message' | 'record' | 'connections';
  title: string;
  connection?: 'zhihu' | 'agent';
  message?: string;
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
  busy: boolean;
  pending: boolean;
  status: WebStatus;
  error: string | null;
  dialog: DialogState | null;
}

export interface RouteNavigationOptions {
  replace?: boolean;
  render?: boolean;
  origin?: RouteMemory;
}
