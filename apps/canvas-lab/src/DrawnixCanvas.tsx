import { useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Drawnix } from '@drawnix/drawnix';
import { PlaitBoard, BoardTransforms, Transforms, getSelectedElements, RectangleClient, type PlaitElement, type PlaitPlugin, type PlaitPluginElementContext, type PlaitOptionsBoard } from '@plait/core';
import { CommonElementFlavour, createActiveGenerator, setCreationMode, getCreationMode, BoardCreationMode } from '@plait/common';
import { ArrowLineShape, ArrowLineMarkerType, WithDrawPluginKey, createArrowLineElement } from '@plait/draw';
import { clone, type EngineProps, type EngineApi } from './model';
import { MaterialCard } from './MaterialCard';

const card = (id: string, index: number): PlaitElement => {
  const x = (index % 3) * 294 + 40, y = Math.floor(index / 3) * 386 + 40;
  return { id, type: 'trace-material', shape: 'rectangle', points: [[x, y], [x + 264, y + 362]], angle: 0, fill: '#ffffff', strokeWidth: 1, materialId: id };
};
function traceCards(props: EngineProps): PlaitPlugin {
  return board => {
    class MaterialFlavour extends CommonElementFlavour {
      content!: SVGForeignObjectElement; root!: Root; active: any;
      initialize() {
        super.initialize();
        this.content = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        this.content.classList.add('trace-material-foreign');
        const host = document.createElement('div'); host.style.cssText = 'width:100%;height:100%';
        this.content.appendChild(host); this.getElementG().appendChild(this.content); this.root = createRoot(host);
        this.active = createActiveGenerator(board, { getRectangle: e => RectangleClient.getRectangleByPoints(e.points!), getStrokeWidth: () => 1, getStrokeOpacity: () => 1, hasResizeHandle: () => true });
        this.getRef().updateActiveSection = () => this.active.processDrawing(this.element, PlaitBoard.getActiveHost(board), { selected: this.selected });
        this.paint();
      }
      paint() {
        const r = RectangleClient.getRectangleByPoints(this.element.points!);
        for (const [k, v] of Object.entries({ x: r.x, y: r.y, width: r.width, height: r.height })) this.content.setAttribute(k, String(v));
        this.root.render(<MaterialCard id={this.element.materialId} store={props.store} />);
        this.active.processDrawing(this.element, PlaitBoard.getActiveHost(board), { selected: this.selected });
      }
      onContextChanged(_value: PlaitPluginElementContext, _previous: PlaitPluginElementContext) { this.paint(); }
      destroy() { const root = this.root; queueMicrotask(() => root?.unmount()); this.active?.destroy(); super.destroy(); }
    }
    const original = board.drawElement;
    board.drawElement = context => context.element.materialId ? MaterialFlavour : original(context);
    // The supported custom-geometry extension is also used by Drawnix freehand.
    // A rich HTML card is NOT a native Slate geometry; don't fake a text manager.
    const rectangle = board.getRectangle, hit = board.isHit, rectangleHit = board.isRectangleHit, movable = board.isMovable, align = board.isAlign;
    board.getRectangle = element => element.type === 'trace-material' ? RectangleClient.getRectangleByPoints(element.points!) : rectangle(element);
    board.isHit = (element, point, strict) => element.type === 'trace-material' ? RectangleClient.isPointInRectangle(board.getRectangle(element)!, point) : hit(element, point, strict);
    board.isRectangleHit = (element, selection) => {
      if (element.type !== 'trace-material') return rectangleHit(element, selection);
      const a = board.getRectangle(element)!, b = RectangleClient.getRectangleByPoints([selection.anchor, selection.focus]);
      return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
    };
    board.isMovable = element => element.type === 'trace-material' || movable(element);
    board.isAlign = element => element.type === 'trace-material' || align(element);
    const optionsBoard = board as PlaitOptionsBoard;
    const existing = optionsBoard.getPluginOptions<any>(WithDrawPluginKey);
    optionsBoard.setPluginOptions(WithDrawPluginKey, { ...existing, customGeometryTypes: [...(existing?.customGeometryTypes || []), 'trace-material'] });
    return board;
  };
}
export default function DrawnixCanvas(props: EngineProps) {
  const boardRef = useRef<PlaitBoard | null>(null);
  const propsRef = useRef(props); propsRef.current = props;
  const initial = useMemo(() => props.initial || { children: Object.keys(props.store.get().materials).map(card), viewport: { origination: [-18, -18], zoom: 0.85 } }, []);
  const plugins = useMemo(() => [traceCards(props)], []);
  const snapshot = () => {
    const board = boardRef.current;
    return board ? clone({ children: board.children, viewport: board.viewport }) : initial;
  };
  const selected = () => { if (!boardRef.current) return []; return getSelectedElements(boardRef.current).map(e => e.materialId).filter(Boolean).sort() as string[]; };
  return <div className="engine-surface drawnix-surface" data-engine-surface="drawnix"><Drawnix value={initial.children} viewport={initial.viewport} extraPlugins={plugins} showDefaultToolbars={false} initialToolState={{ pointer: 'selection' }}
    onChange={() => { propsRef.current.change(snapshot()); propsRef.current.selection(selected()); }}
    afterInit={(board: PlaitBoard) => {
      boardRef.current = board;
      const api: EngineApi = {
        diagnostics: () => ({ pointer: board.pointer, mode: getCreationMode(board), selected: getSelectedElements(board).map(e => e.id), viewport: clone(board.viewport) }),
        snapshot,
        select: ids => { if (ids.length) Transforms.addSelectionWithTemporaryElements(board, board.children.filter(e => ids.includes(e.materialId))); else Transforms.setSelection(board, null); },
        tool: value => { if (value === 'ink') setCreationMode(board, BoardCreationMode.drawing); BoardTransforms.updatePointerType(board, value === 'ink' ? 'feltTipPen' : value === 'pan' ? 'hand' : 'selection'); },
        undo: () => board.undo(), redo: () => board.redo(),
        fit: () => BoardTransforms.fitViewport(board),
        group: () => Transforms.addGroup(board), ungroup: () => Transforms.removeGroup(board),
        connect: (from, to, id) => {
          const a = board.children.find(e => e.materialId === from), b = board.children.find(e => e.materialId === to);
          if (!a || !b) return;
          const ra = board.getRectangle(a), rb = board.getRectangle(b);
          if (!ra || !rb) return;
          const line = createArrowLineElement(ArrowLineShape.curve, [[ra.x + ra.width, ra.y + ra.height / 2], [rb.x, rb.y + rb.height / 2]], { marker: ArrowLineMarkerType.none, boundId: a.id, connection: [1, 0.5] }, { marker: ArrowLineMarkerType.arrow, boundId: b.id, connection: [0, 0.5] });
          Transforms.insertNode(board, { ...line, id, traceRelation: true }, [board.children.length]);
        },
        unlink: () => { [...board.children].map((e, i) => e.type === 'arrow-line' ? i : -1).filter(i => i >= 0).reverse().forEach(i => Transforms.removeNode(board, [i])); },
        add: id => { if (!board.children.some(e => e.materialId === id)) Transforms.insertNode(board, card(id, board.children.filter(e => e.materialId).length), [board.children.length]); },
      };
      propsRef.current.ready(api); propsRef.current.change(snapshot());
    }} /></div>;
}
