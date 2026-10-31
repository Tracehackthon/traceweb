/* Infinite Canvas, copyright (c) 2026 basketikun, MIT.
 * Fixed source 9cd3deacbcc598361807afc16c059a80dd18b6f9.
 * Adapted theme/class names and pan cancellation; no upstream persistence. */
import React, { useEffect, useRef, useState } from "react";

import type { ViewportTransform } from "./types";
type CanvasBackgroundMode = 'blank' | 'dots' | 'lines';
const theme = {canvas:{background:'var(--trace-surface-workbench)',dot:'var(--trace-grid-dot)',line:'var(--trace-border-subtle)'}};
// Native editing, playback and scrollable excerpts own their input. Upstream
// popover class names are not dependencies of the Trace workbench.
const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,button,a,audio,video,[contenteditable="true"],[role="menu"],[role="dialog"],[data-canvas-no-zoom]'));
const localScroll = (target: EventTarget | null) => interactive(target) || (target instanceof Element && Boolean(target.closest('.wb-card-body')));

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function InfiniteCanvas({ containerRef, viewport, tool, backgroundMode = "lines", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: InfiniteCanvasProps) {
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
    });
    const scaleRef = useRef(viewport.k);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    // Gesture listeners keep their lifetime while renders update only callbacks.
    // Rebinding mid-Escape can remove the pending cancel listener in that event.
    const callbacks=useRef({onCanvasDeselect,onViewportChange});
    callbacks.current={onCanvasDeselect,onViewportChange};
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isControlPressed, setIsControlPressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useEffect(() => {
        scaleRef.current = viewport.k;
    }, [viewport.k]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || interactive(event.target)) return;
            if (event.key === "Control") setIsControlPressed(true);
            if (event.code !== "Space") return;
            event.preventDefault();
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                if (!interactive(event.target)) event.preventDefault();
                setIsSpacePressed(false);
            }
            if (event.key === "Control") setIsControlPressed(false);
        };

        const handleBlur = () => {
            setIsSpacePressed(false);
            setIsControlPressed(false);
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            nextViewportRef.current = null;
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (localScroll(event.target)) return;

        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(viewport.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - viewport.x) / viewport.k;
        const worldY = (mouseY - viewport.y) / viewport.k;

        onViewportChange({
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (interactive(event.target)) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        event.currentTarget.focus({preventScroll:true});
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const temporaryTool = event.ctrlKey || isSpacePressed;
        const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
        const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan");

        if (shouldPan) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewport.x,
                initialY: viewport.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (nextViewportRef.current) callbacks.current.onViewportChange(nextViewportRef.current);
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            if (nextViewportRef.current) callbacks.current.onViewportChange(nextViewportRef.current);
            nextViewportRef.current = null;

            if (!panState.current.hasMoved && panState.current.startedOnBackground) {
                callbacks.current.onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        const cancelPan = () => {
            if (!panState.current.isPanning) return;
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            nextViewportRef.current = null;
            callbacks.current.onViewportChange({x:panState.current.initialX,y:panState.current.initialY,k:scaleRef.current});
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelPan(); };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelPan);
        window.addEventListener("keydown", key);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelPan);
            window.removeEventListener("keydown", key);
            document.body.style.cursor = "";
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            if (localScroll(event.target)) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    const temporaryTool = isControlPressed || isSpacePressed;
    const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
    const cursor = isPanning ? "grabbing" : activeTool === "pan" ? "grab" : undefined;

    return (
        <div
            ref={containerRef}
            className="wb-ic-viewport"
            tabIndex={0}
            role="region"
            aria-label="画布操作区域"
            style={{ background: theme.canvas.background, cursor }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} />
            <div
                className="wb-ic-world"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            className="wb-ic-grid"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
