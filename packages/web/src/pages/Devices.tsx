import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  DeviceDetailResponse,
  DeviceListItem,
  DevicesResponse,
  SettingsResponse,
} from '@sense/shared';
import { get } from '../api/client.js';
import { DeviceIcon } from '../components/DeviceIcon.js';
import { UsageBarChart } from '../components/charts/UsageBarChart.js';
import { SkeletonRows } from '../components/Skeleton.js';
import { formatCurrency, formatDayLabel, formatRelativeTime, formatWatts } from '../lib/format.js';

type SortKey = 'name' | 'nowW' | 'todayKwh' | 'monthKwh' | 'monthCost';

/** Small-caps colored label above a card's content — matches the real
 *  Sense app's "AVERAGE" / "STATS" / "USAGE" card-section pattern. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div
      className="mb-2 text-xs font-bold tracking-wider"
      style={{ color: 'var(--series-1)' }}
    >
      {children.toUpperCase()}
    </div>
  );
}

function DeviceList({
  devices,
  selectedId,
  currency,
  onSelect,
}: {
  devices: DeviceListItem[];
  selectedId: string | undefined;
  currency: string;
  onSelect: (id: string) => void;
}) {
  const [sortKey] = useState<SortKey>('nowW');
  const [asc] = useState(false);

  const sorted = devices.slice().sort((a, b) => {
    const dir = asc ? 1 : -1;
    if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
    const av = (a[sortKey] as number | null) ?? -1;
    const bv = (b[sortKey] as number | null) ?? -1;
    return (av - bv) * dir;
  });

  return (
    <div className="flex w-64 flex-shrink-0 flex-col gap-1.5 overflow-y-auto pr-1">
      {sorted.map((d) => {
        const active = d.id === selectedId;
        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            className="flex items-center gap-3 rounded-lg p-2.5 text-left transition-colors"
            style={{
              background: active ? '#fff' : 'var(--surface-1)',
              color: active ? '#111' : undefined,
              opacity: d.revoked ? 0.5 : 1,
            }}
          >
            <DeviceIcon icon={d.icon} className="text-2xl" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{d.name}</div>
              <div
                className="text-xs tabular-nums"
                style={{ color: active ? '#555' : 'var(--text-muted)' }}
              >
                {formatWatts(d.nowW)}
              </div>
            </div>
            {d.nowW !== null && d.nowW > 1 && (
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: 'var(--status-warning)' }}
              />
            )}
          </button>
        );
      })}
      {sorted.length === 0 && (
        <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No devices yet — Sense discovers devices over time.
        </div>
      )}
    </div>
  );
}

function DeviceDetailPanel({ id, currency }: { id: string; currency: string }) {
  const [scale, setScale] = useState<'day' | 'month'>('day');
  const detail = useQuery({
    queryKey: ['device', id],
    queryFn: () => get<DeviceDetailResponse>(`/api/devices/${id}`),
  });

  if (detail.isLoading) return <SkeletonRows rows={6} />;
  if (detail.isError || !detail.data) {
    return (
      <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        Device not found.
      </div>
    );
  }
  const { device, nowW, daily, monthly, events, typicalRun } = detail.data;

  // Estimated kWh/year and average monthly cost, derived from whichever
  // window has data — no separate "yearly stats" endpoint exists, so this
  // is computed client-side from the daily/monthly buckets we already have.
  const monthsWithData = monthly.filter((m) => m.kwh > 0);
  const avgMonthlyKwh = monthsWithData.length
    ? monthsWithData.reduce((s, m) => s + m.kwh, 0) / monthsWithData.length
    : null;
  const avgMonthlyCost = monthsWithData.length
    ? monthsWithData.reduce((s, m) => s + m.cost, 0) / monthsWithData.length
    : null;
  const estYearlyKwh = avgMonthlyKwh !== null ? avgMonthlyKwh * 12 : null;

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="flex items-center gap-4">
        <DeviceIcon icon={device.icon} className="text-5xl" />
        <div>
          <h1 className="text-2xl font-bold">
            {device.name}
            {device.revoked && (
              <span className="ml-2 text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                (removed by Sense)
              </span>
            )}
          </h1>
          <div className="flex items-center gap-1.5 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: nowW && nowW > 1 ? 'var(--status-warning)' : 'var(--text-muted)' }}
            />
            {formatWatts(nowW)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-4">
          {(estYearlyKwh !== null || avgMonthlyCost !== null) && (
            <div className="card p-4">
              <SectionLabel>Stats</SectionLabel>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {estYearlyKwh !== null && (
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span>
                      Estimated kWh/year
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Based on your usage
                      </div>
                    </span>
                    <span className="tabular-nums font-semibold">{estYearlyKwh.toFixed(1)} kWh</span>
                  </div>
                )}
                {avgMonthlyCost !== null && (
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span>Average Cost per Month</span>
                    <span className="tabular-nums font-semibold">
                      {formatCurrency(avgMonthlyCost, currency)}
                    </span>
                  </div>
                )}
                {typicalRun && (
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span>
                      Typical run
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {typicalRun.runs} recent runs
                      </div>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {Math.round(typicalRun.durationS / 60)} min
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card p-4">
            <SectionLabel>Recent activity</SectionLabel>
        {events.length === 0 ? (
          <div className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No on/off events recorded yet.
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span
                    className="mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      background: 'var(--surface-2)',
                      color: e.type === 'on' ? 'var(--status-good)' : 'var(--text-muted)',
                    }}
                  >
                    {e.type.toUpperCase()}
                  </span>
                  {e.watts !== null && <span className="tabular-nums">{formatWatts(e.watts)}</span>}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {formatRelativeTime(e.ts)}
                </span>
              </li>
            ))}
          </ul>
        )}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Usage</SectionLabel>
            <div className="flex gap-4 text-sm font-medium">
              {(['day', 'month'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className="border-b-2 pb-0.5 capitalize transition-colors"
                  style={{
                    borderColor: scale === s ? 'var(--series-1)' : 'transparent',
                    color: scale === s ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {scale === 'day' ? (
            <UsageBarChart
              buckets={daily.map((d) => ({ label: d.day, kwh: d.kwh, cost: d.cost }))}
              currency={currency}
              labelFormatter={formatDayLabel}
            />
          ) : (
            <UsageBarChart
              buckets={monthly.map((m) => ({ label: m.month, kwh: m.kwh, cost: m.cost }))}
              currency={currency}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function Devices() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => get<DevicesResponse>('/api/devices'),
    refetchInterval: 15_000,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<SettingsResponse>('/api/settings'),
  });
  const currency = settings.data?.currency ?? 'USD';
  const list = devices.data?.devices ?? [];

  // Real Sense always has a device selected in the right panel — default to
  // the highest-drawing device rather than showing an empty state, matching
  // that behavior (its /devices route redirects to one immediately too).
  const selectedId = id ?? list.slice().sort((a, b) => (b.nowW ?? -1) - (a.nowW ?? -1))[0]?.id;

  if (devices.isLoading) return <SkeletonRows rows={6} />;

  return (
    <div className="flex gap-4">
      <DeviceList
        devices={list}
        selectedId={selectedId}
        currency={currency}
        onSelect={(newId) => navigate(`/devices/${newId}`)}
      />
      {selectedId ? (
        <DeviceDetailPanel id={selectedId} currency={currency} />
      ) : (
        <div className="flex flex-1 items-center justify-center" style={{ color: 'var(--text-muted)' }}>
          No devices yet — Sense discovers devices over time.
        </div>
      )}
    </div>
  );
}
