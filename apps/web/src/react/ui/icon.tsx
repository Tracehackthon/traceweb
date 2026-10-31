import React from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, Clock3, Code2, Ellipsis, ExternalLink, FileText, GitCompareArrows, History, Library, Link, LoaderCircle, MessagesSquare, Search, Settings, Unlink, Workflow, X, PanelsTopLeft, MousePointer2, Hand, Type, Pencil, Image, Video, AudioLines, Plus, Copy, Group, Scan, Undo2, Redo2, Upload } from 'lucide-react';

// One semantic map; callers do not select an unrelated icon library per page.
const icons = { back: ArrowLeft, forward: ArrowRight, check: Check, down: ChevronDown, right: ChevronRight, idle: Circle, error: CircleAlert, success: CircleCheck, pending: Clock3, code: Code2, more: Ellipsis, external: ExternalLink, document: FileText, compare: GitCompareArrows, history: History, library: Library, link: Link, spinner: LoaderCircle, discussion: MessagesSquare, search: Search, settings: Settings, unlink: Unlink, work: Workflow, close: X, canvas:PanelsTopLeft,pointer:MousePointer2,hand:Hand,text:Type,pencil:Pencil,image:Image,video:Video,audio:AudioLines,plus:Plus,copy:Copy,group:Group,fit:Scan,undo:Undo2,redo:Redo2,upload:Upload };
export type IconName = keyof typeof icons;
export function TraceIcon({ name, size = 18, className = '' }: { name: IconName; size?: 16 | 18 | 20; className?: string }) {
  const Icon = icons[name];
  return <Icon data-optical={name === 'forward' || name === 'back' ? name : undefined} size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" className={`tu-icon ${className}`} />;
}
