import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { forceCollide, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';
import type { DevicesResponse, EventsResponse, SettingsResponse } from '@sense/shared';
import { get } from '../api/client.js';
import { DeviceIcon } from '../components/DeviceIcon.js';
import { useLiveSocket } from '../hooks/useLiveSocket.js';
import { formatRelativeTime, formatWatts } from '../lib/format.js';

const SENSE_ORANGE = '#f9461c';
const OTHER_GRAY = '#6b6b66';
const MIN_R = 46;
const MAX_R = 116;
/** Extra space kept between bubbles by the collision force. */
const GAP = 2;
/** How fast a bubble's radius eases toward its target wattage-derived
 *  size each incoming live frame — keeps the collision force (and the
 *  visible size) from jumping with every second-to-second reading. */
const SIZE_SMOOTHING = 0.15;

interface BubbleNode {
  id: string;
  name: string;
  icon: string | null;
  w: number;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

function balloonRadius(w: number, maxW: number): number {
  const t = Math.sqrt(Math.max(w, 0) / maxW);
  return MIN_R + t * (MAX_R - MIN_R);
}

/** 0 at the smallest bubble, 1 at the largest — drives font size. */
function sizeT(r: number): number {
  return Math.min(1, Math.max(0, (r - MIN_R) / (MAX_R - MIN_R)));
}

/** SVG text doesn't wrap on its own — greedily split into up to 2 lines. */
function wrapName(name: string, r: number): string[] {
  const maxChars = Math.max(6, Math.round(r / 5.5));
  const words = name.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length <= maxChars || !cur) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
      if (lines.length === 2) break;
    }
  }
  if (lines.length < 2 && cur) lines.push(cur);
  return lines.slice(0, 2);
}

function formatWattsPlain(w: number | null | undefined): string {
  if (w === null || w === undefined) return '—';
  return `${Math.round(w).toLocaleString()} W`;
}

function costPerHour(watts: number, rateCentsPerKwh: number): number {
  return (watts / 1000) * (rateCentsPerKwh / 100);
}

function formatCostPerHour(dollarsPerHr: number, currency: string): string {
  const digits = dollarsPerHr < 0.1 ? 3 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(dollarsPerHr);
  } catch {
    return `${dollarsPerHr.toFixed(digits)} ${currency}`;
  }
}

/** Left-hand "today" event log, matching the real Now page's timeline. */
function Timeline() {
  const events = useQuery({
    queryKey: ['events', 'today'],
    queryFn: () => get<EventsResponse>('/api/events'), // defaults to last 24h
    refetchInterval: 30_000,
  });
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => get<DevicesResponse>('/api/devices'),
  });
  const iconByDevice = new Map((devices.data?.devices ?? []).map((d) => [d.id, d.icon]));

  return (
    <div className="flex w-64 flex-shrink-0 flex-col overflow-y-auto">
      <div
        className="mb-2 flex-shrink-0 text-xs font-bold tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        TODAY
      </div>
      {!events.data || events.data.events.length === 0 ? (
        <div className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {events.data ? 'No activity yet today.' : 'Loading…'}
        </div>
      ) : (
        <ul>
          {events.data.events.map((e) => (
            <li key={e.id} className="relative flex gap-3 pb-4 pl-1">
              <div
                className="absolute bottom-0 left-[13px] top-6 w-px"
                style={{ background: 'var(--border)' }}
              />
              <DeviceIcon icon={iconByDevice.get(e.deviceId) ?? null} className="z-10 flex-shrink-0 text-xl" />
              <div className="min-w-0 flex-1">
                <div className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {formatRelativeTime(e.ts)}
                </div>
                <div className="text-sm font-medium">
                  {e.deviceName} turned {e.type}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Now() {
  const navigate = useNavigate();
  const { frame, stale } = useLiveSocket();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<SettingsResponse>('/api/settings'),
  });
  const rateCentsPerKwh = settings.data?.rateCentsPerKwh ?? 0;
  const currency = settings.data?.currency ?? 'USD';

  // The bubble box sizes itself to whatever space is actually available in
  // the browser window, via a callback ref + ResizeObserver (reading the
  // size directly on attach, since some environments don't fire
  // ResizeObserver's initial callback for an already-stable size).
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  useLayoutEffect(() => {
    if (!containerEl) return;
    const measure = (): void => {
      const rect = containerEl.getBoundingClientRect();
      setDims({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  const simRef = useRef<Simulation<BubbleNode, undefined> | null>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const maxWRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);

  useEffect(() => {
    const sim = forceSimulation<BubbleNode>([])
      .force(
        'collide',
        forceCollide<BubbleNode>((d) => d.r + GAP).iterations(3),
      )
      .alphaDecay(0.03)
      // A small constant simmer keeps bubbles re-flowing as wattages change
      // instead of cooling to a stop and lurching on the next topology
      // change — but kept low so it reads as "settled" rather than
      // perpetually drifting.
      .alphaTarget(0.008)
      .on('tick', rerender);
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, []);

  // Keep the centering forces pointed at the middle of whatever space is
  // currently available, and give the simulation a nudge so bubbles drift
  // to the new center when the window is resized.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    // Strength scales with radius so the biggest bubble pulls hardest to
    // center and displaces smaller ones — a flat strength for every node
    // tends to settle into a hollow ring instead, since nothing lets the
    // big one push past the smaller ones once they've formed a perimeter.
    const centerStrength = (d: BubbleNode): number => 0.03 + 0.35 * (d.r / MAX_R);
    sim
      .force('x', forceX<BubbleNode>(dims.width / 2).strength(centerStrength))
      .force('y', forceY<BubbleNode>(dims.height / 2).strength(centerStrength));
    sim.alpha(Math.max(sim.alpha(), 0.4)).restart();
  }, [dims.width, dims.height]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const live = (frame?.devices ?? []).filter((d) => d.w > 1);
    const rawMaxW = Math.max(...live.map((d) => d.w), 1);
    // Smoothed the same way individual radii are (SIZE_SMOOTHING) — without
    // this, a single device's instant-wattage spike/dip shifts the shared
    // denominator every bubble's radius is computed from, so the whole
    // cluster visibly pulses together even though no bubble's own reading
    // changed much.
    maxWRef.current =
      maxWRef.current === null
        ? rawMaxW
        : maxWRef.current + (rawMaxW - maxWRef.current) * SIZE_SMOOTHING;
    const maxW = maxWRef.current;
    const liveIds = new Set(live.map((d) => d.id));

    const beforeCount = nodesRef.current.length;
    nodesRef.current = nodesRef.current.filter((n) => liveIds.has(n.id));
    let topologyChanged = nodesRef.current.length !== beforeCount;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));

    for (const d of live) {
      const targetR = balloonRadius(d.w, maxW);
      const existing = byId.get(d.id);
      if (existing) {
        existing.w = d.w;
        existing.name = d.name;
        existing.icon = d.icon;
        existing.r += (targetR - existing.r) * SIZE_SMOOTHING;
      } else {
        topologyChanged = true;
        // Spawn just outside the cluster's area and let the centering
        // force pull it in, rather than popping in already in place.
        const angle = Math.random() * Math.PI * 2;
        // Just outside where the cluster naturally settles, not
        // proportional to the window — on a big screen a window-relative
        // distance sends brand-new bubbles so far out they take ages to
        // migrate back in, splitting the group into slow-converging halves.
        const spawnDist = Math.min(Math.max(dims.width, dims.height) * 0.65, 400);
        nodesRef.current.push({
          id: d.id,
          name: d.name,
          icon: d.icon,
          w: d.w,
          r: targetR,
          x: dims.width / 2 + Math.cos(angle) * spawnDist,
          y: dims.height / 2 + Math.sin(angle) * spawnDist,
          vx: 0,
          vy: 0,
        });
      }
    }

    sim.nodes(nodesRef.current);
    // The permanent alphaTarget simmer already keeps things ticking and
    // re-rendering every frame, so a topology change only needs a modest
    // extra kick — enough for a newly spawned bubble to migrate in at a
    // reasonable pace, not a full-alpha reheat that reads as a snap.
    if (topologyChanged) {
      sim.alpha(Math.max(sim.alpha(), 0.15)).restart();
    }
    // dims intentionally excluded — new-node spawn position only needs the
    // latest dims at spawn time, not a resize-triggered re-run here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  function onPointerDown(e: React.PointerEvent, node: BubbleNode): void {
    e.preventDefault();
    const sim = simRef.current;
    const svg = svgRef.current;
    if (!sim || !svg) return;
    sim.alphaTarget(0.3).restart();
    node.fx = node.x;
    node.fy = node.y;

    // Real Sense treats a click (no meaningful movement) on a bubble as
    // navigation to that device's page, while a drag repositions it — track
    // total pointer travel so pointerup can tell the two apart.
    const downX = e.clientX;
    const downY = e.clientY;
    let dragDistance = 0;

    const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svg.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const move = (ev: PointerEvent): void => {
      dragDistance = Math.max(
        dragDistance,
        Math.hypot(ev.clientX - downX, ev.clientY - downY),
      );
      const p = toLocal(ev.clientX, ev.clientY);
      node.fx = p.x;
      node.fy = p.y;
    };
    const up = (): void => {
      sim.alphaTarget(0);
      node.fx = null;
      node.fy = null;
      if (dragDistance < 5 && node.id !== 'unknown') {
        navigate(`/devices/${node.id}`);
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const nodes = nodesRef.current;

  return (
    <div className="flex flex-col gap-4 p-4" style={{ height: '100vh' }}>
      <div className="flex flex-shrink-0 justify-end gap-3">
        <div
          className="rounded-md px-3 py-1.5 text-right transition-opacity"
          style={{ background: 'var(--surface-2)', opacity: stale ? 0.4 : 1 }}
        >
          <div className="text-2xl font-bold tabular-nums leading-tight">
            {frame ? formatWattsPlain(frame.w) : '—'}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            total now
          </div>
        </div>
        <div
          className="rounded-md px-3 py-1.5 text-right transition-opacity"
          style={{ background: 'var(--surface-2)', opacity: stale ? 0.4 : 1 }}
        >
          <div className="text-2xl font-bold tabular-nums leading-tight">
            {frame ? formatCostPerHour(costPerHour(frame.w, rateCentsPerKwh), currency) : '—'}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            per hour
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <Timeline />
        <div ref={setContainerEl} className="min-h-0 flex-1">
        {nodes.length === 0 ? (
          <div
            className="flex h-full items-center justify-center rounded-xl text-sm"
            style={{ background: 'var(--page-plane)', color: 'var(--text-muted)' }}
          >
            {frame ? 'Nothing detected on right now' : 'Waiting for device data…'}
          </div>
        ) : (
          <svg
            ref={svgRef}
            width={dims.width}
            height={dims.height}
            viewBox={`0 0 ${dims.width} ${dims.height}`}
            style={{
              display: 'block',
              userSelect: 'none',
              background: 'var(--page-plane)',
              borderRadius: '0.75rem',
            }}
          >
            {nodes.map((n) => {
              const color = n.id === 'unknown' ? OTHER_GRAY : SENSE_ORANGE;
              const t = sizeT(n.r);
              const nameLines = wrapName(n.name, n.r);
              const nameFont = 9 + t * 11;
              const wattsFont = 11 + t * 15;
              const costFont = 8 + t * 8;
              // Stack name line(s), watts, and cost as rows of known height,
              // then center the whole block on the bubble — using
              // dominant-baseline: central per row sidesteps baseline math
              // that was previously under-spacing rows into each other.
              const rowFonts = [...nameLines.map(() => nameFont), wattsFont, costFont];
              const rowHeights = rowFonts.map((f) => f * 1.15);
              const totalHeight = rowHeights.reduce((a, b) => a + b, 0);
              let rowTop = -totalHeight / 2;
              const rowCenters = rowHeights.map((h) => {
                const cy = rowTop + h / 2;
                rowTop += h;
                return cy;
              });
              const nameCenters = rowCenters.slice(0, nameLines.length);
              const wattsCenter = rowCenters[nameLines.length];
              const costCenter = rowCenters[nameLines.length + 1];
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  onPointerDown={(e) => onPointerDown(e, n)}
                >
                  <circle r={n.r} fill={color} />
                  {nameLines.map((line, i) => (
                    <text
                      key={i}
                      y={nameCenters[i]}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={nameFont}
                      fontWeight="bold"
                      fill="#fff"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {line}
                    </text>
                  ))}
                  <text
                    y={wattsCenter}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={wattsFont}
                    fontWeight="600"
                    fill="#fff"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {formatWatts(n.w)}
                  </text>
                  <text
                    y={costCenter}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={costFont}
                    fill="#fff"
                    opacity={0.8}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {formatCostPerHour(costPerHour(n.w, rateCentsPerKwh), currency)}/hr
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        </div>
      </div>
    </div>
  );
}
