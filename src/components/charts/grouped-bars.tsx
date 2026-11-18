export type BarGroup = {
  key: string;
  label: string;
  /** Second line under the group (e.g. "n = 12"). */
  sub?: string;
  values: Record<string, number | null>;
  /** Why the group has no bars (e.g. under the minimum). */
  masked?: string;
};

const H = 140;

/**
 * Vertical grouped bars on a fixed scale (e.g. the 1–5 means): one bar per
 * series in each group, the value written on top, the group and its n under
 * it, a focusable bar with its tooltip, masked groups explained in place.
 */
export function GroupedBars({
  groups,
  series,
  domain,
  ticks,
  fmt,
  label,
  yTitle,
  xTitle,
  testId = "grouped-bars",
}: {
  xTitle?: string;
  groups: BarGroup[];
  series: { key: string; label: string; fill: string }[];
  domain: [number, number];
  ticks: number[];
  fmt: (v: number) => string;
  label: string;
  yTitle: string;
  testId?: string;
}) {
  const y = (v: number) => ((v - domain[0]) / (domain[1] - domain[0])) * H;
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-1"
      data-testid={testId}
    >
      <span className="text-xs text-muted-foreground">{yTitle}</span>
      <div className="flex gap-2">
        <div
          className="relative w-6"
          style={{ height: H + 18 }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 text-xs text-muted-foreground tabular-nums"
              style={{ bottom: y(t) - 7 }}
            >
              {fmt(t)}
            </span>
          ))}
        </div>
        <div
          className="relative flex flex-1 items-end gap-3 border-b border-border"
          style={{ height: H + 18 }}
        >
          {ticks.map((t) => (
            <span
              key={t}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-border/60"
              style={{ bottom: y(t) }}
            />
          ))}
          {groups.map((g) => (
            <div
              key={g.key}
              className="relative flex min-w-16 flex-1 items-end justify-center gap-1"
              data-testid="bar-group"
            >
              {g.masked ? (
                <span className="self-center px-1 text-center text-xs text-muted-foreground">
                  {g.masked}
                </span>
              ) : (
                series.map((s) => {
                  const v = g.values[s.key];
                  if (v === null || v === undefined)
                    return <span key={s.key} className="w-6" />;
                  const tip = `${g.label} · ${s.label}: ${fmt(v)}`;
                  return (
                    <div
                      key={s.key}
                      className="flex w-7 flex-col items-center gap-0.5"
                    >
                      <span className="text-xs font-medium tabular-nums">
                        {fmt(v)}
                      </span>
                      <span
                        role="img"
                        aria-label={tip}
                        data-tip={tip}
                        tabIndex={0}
                        className={`w-full rounded-t-[4px] outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring ${s.fill}`}
                        style={{ height: Math.max(4, y(v)) }}
                      />
                    </div>
                  );
                })
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <span className="w-6" />
        <div className="flex flex-1 gap-3">
          {groups.map((g) => (
            <div
              key={g.key}
              className="flex min-w-16 flex-1 flex-col items-center text-xs"
            >
              <span>{g.label}</span>
              {g.sub ? (
                <span className="text-muted-foreground tabular-nums">
                  {g.sub}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {xTitle ? (
        <span className="text-center text-xs text-muted-foreground">
          {xTitle} →
        </span>
      ) : null}
    </div>
  );
}
