import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Handle, Position, Background, ViewportPortal, useReactFlow, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeProps } from '@xyflow/react';
import getStroke from 'perfect-freehand';
import '@xyflow/react/dist/style.css';
import { clone, type EngineProps, type EngineApi } from './model';
import { MaterialCard } from './MaterialCard';

function Card({ data }: NodeProps) {
  return <><Handle type="target" position={Position.Left} /><MaterialCard id={data.materialId as string} store={data.store as any} /><Handle type="source" position={Position.Right} /></>;
}
function Ink({ data }: NodeProps) {
  const pts = getStroke(data.points as number[][], { size: 4, thinning: 0.2 });
  const path = pts.length ? `M${pts.map(p => p.join(',')).join('L')}Z` : '';
  return <svg width={data.width as number} height={data.height as number} style={{ overflow: 'visible' }}><path d={path} fill="#2d6a4f" /></svg>;
}
const nodeTypes = { material: Card, ink: Ink };
const cleanNodes = (nodes: Node[]) => nodes.map(n => {
  const { selected, dragging, measured, ...rest } = n;
  const { store, ...data } = rest.data;
  return { ...rest, data };
});
function Canvas(props: EngineProps) {
  const flow = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>(() => props.initial?.nodes || Object.keys(props.store.get().materials).map((id, i) => ({ id, type: 'material', position: { x: (i % 3) * 294 + 40, y: Math.floor(i / 3) * 386 + 40 }, data: { materialId: id }, dragHandle: '.card-grip' })));
  const [edges, setEdges] = useState<Edge[]>(props.initial?.edges || []);
  const [tool, setTool] = useState<'select' | 'ink' | 'pan'>('select');
  const current = useRef({ nodes, edges }); current.current = { nodes, edges };
  const propsRef = useRef(props); propsRef.current = props;
  const history = useRef<{ undo: any[]; redo: any[] }>({ undo: [], redo: [] });
  const stroke = useRef<{ x: number; y: number }[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const selectionKey = useRef('');
  const snapshot = useCallback(() => ({ nodes: cleanNodes(current.current.nodes), edges: clone(current.current.edges.map(({ selected, ...edge }) => edge)), viewport: flow.getViewport() }), [flow]);
  const checkpoint = useCallback(() => { history.current.undo.push(snapshot()); history.current.redo = []; }, [snapshot]);
  const restore = useCallback((s: any) => { setNodes(s.nodes); setEdges(s.edges); void flow.setViewport(s.viewport); }, [flow]);
  const commit = (nextNodes: Node[], nextEdges = current.current.edges) => { checkpoint(); setNodes(nextNodes); setEdges(nextEdges); };
  useEffect(() => {
    const api: EngineApi = {
      snapshot,
      select: ids => setNodes(ns => ns.map(n => ({ ...n, selected: ids.includes(n.id) }))),
      tool: setTool,
      undo: () => { const s = history.current.undo.pop(); if (s) { history.current.redo.push(snapshot()); restore(s); } },
      redo: () => { const s = history.current.redo.pop(); if (s) { history.current.undo.push(snapshot()); restore(s); } },
      fit: () => { void flow.fitView({ maxZoom: 1, padding: 0.12 }); },
      group: () => {
        const ns = current.current.nodes, selected = ns.filter(n => n.selected && n.type === 'material' && !n.parentId);
        if (selected.length < 2) return;
        const x = Math.min(...selected.map(n => n.position.x)) - 18, y = Math.min(...selected.map(n => n.position.y)) - 30;
        const right = Math.max(...selected.map(n => n.position.x + 264)), bottom = Math.max(...selected.map(n => n.position.y + 362));
        const id = `g-${Date.now()}`;
        commit([{ id, type: 'group', position: { x, y }, style: { width: right - x + 18, height: bottom - y + 18, background: '#e4f1e83b' }, data: {}, selected: true }, ...ns.map(n => selected.includes(n) ? { ...n, parentId: id, position: { x: n.position.x - x, y: n.position.y - y }, selected: false } : n)]);
      },
      ungroup: () => {
        const ns = current.current.nodes; const groups = ns.filter(n => n.type === 'group');
        commit(ns.filter(n => n.type !== 'group').map(n => { const p = groups.find(g => g.id === n.parentId); if (!p) return n; const { parentId, ...rest } = n; return { ...rest, position: { x: n.position.x + p.position.x, y: n.position.y + p.position.y } }; }));
      },
      connect: (from, to, id) => { checkpoint(); setEdges(es => [...es, { id, source: from, target: to, label: '值得一起看 · 未定', type: 'default' }]); },
      unlink: () => { checkpoint(); setEdges([]); },
      add: id => { if (!current.current.nodes.some(n => n.id === id)) commit([...current.current.nodes, { id, type: 'material', position: { x: 40, y: Math.ceil(current.current.nodes.length / 3) * 386 + 40 }, data: { materialId: id }, dragHandle: '.card-grip' }]); },
    };
    propsRef.current.ready(api);
    // Deliberately stable API: current engine state is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    propsRef.current.change(snapshot());
    const ids = nodes.filter(n => n.selected && n.type === 'material').map(n => n.id).sort();
    if (ids.join(',') !== selectionKey.current) { selectionKey.current = ids.join(','); propsRef.current.selection(ids); }
  }, [nodes, edges, snapshot]);
  return <div className={`engine-surface flow-surface tool-${tool}`} data-engine-surface="reactflow">
    <ReactFlow nodes={nodes.map(n => n.type === 'material' ? { ...n, data: { ...n.data, store: props.store } } : n)} edges={edges} nodeTypes={nodeTypes}
      defaultViewport={props.initial?.viewport || { x: 15, y: 15, zoom: 0.85 }}
      onNodesChange={changes => setNodes(ns => applyNodeChanges(changes, ns))}
      onEdgesChange={changes => setEdges(es => applyEdgeChanges(changes, es))}
      onNodeDragStart={checkpoint} onConnect={c => { checkpoint(); setEdges(es => [...es, { ...c, id: `link-${Date.now()}`, label: '值得一起看 · 未定' }]); }}
      onMoveEnd={() => propsRef.current.change(snapshot())}
      nodesDraggable={tool === 'select'} elementsSelectable={tool === 'select'} panOnDrag={tool === 'pan' ? true : [1, 2]} selectionOnDrag={tool === 'select'}
      minZoom={0.15} maxZoom={2} deleteKeyCode={null} onlyRenderVisibleElements={false}>
      <Background color="#d9ded9" gap={22} />
      <ViewportPortal>{draft.length > 1 && <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }}><polyline points={draft.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2d6a4f" strokeWidth={3} /></svg>}</ViewportPortal>
    </ReactFlow>
    {tool === 'ink' && <div className="ink-input" data-ink-input="reactflow" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); stroke.current = [flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })]; setDraft(stroke.current); }}
      onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; stroke.current = [...stroke.current, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })]; setDraft(stroke.current); }}
      onPointerUp={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; e.currentTarget.releasePointerCapture(e.pointerId); const points = stroke.current; if (points.length > 1) { checkpoint(); const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y)), width = Math.max(...points.map(p => p.x)) - x + 4, height = Math.max(...points.map(p => p.y)) - y + 4; setNodes(ns => [...ns, { id: `ink-${Date.now()}`, type: 'ink', position: { x, y }, data: { points: points.map(p => [p.x - x, p.y - y]), width, height }, style: { width, height } }]); } stroke.current = []; setDraft([]); }} />}
  </div>;
}
export default function ReactFlowCanvas(props: EngineProps) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
