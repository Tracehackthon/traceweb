// Editor-only projection used by the adapted Infinite Canvas geometry.
export enum CanvasNodeType { Group='group', Config='config', Text='text' }
export interface Position {x:number;y:number}
export interface ViewportTransform extends Position {k:number}
export interface CanvasNodeData {id:string;type:CanvasNodeType;position:Position;width:number;height:number;metadata?:{groupId?:string}}
export interface CanvasConnection {id:string;fromNodeId:string;toNodeId:string}
export interface ConnectionHandle {nodeId:string;handleType:'source'|'target'}
