import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import { getAiUsageStatistics, type AiUsagePeriod, type AiUsageStatistics } from "./api";

const PERIODS: Array<{ value: AiUsagePeriod; label: "statistics.today" | "statistics.sevenDays" | "statistics.month" }> = [
  { value: "today", label: "statistics.today" },
  { value: "seven_days", label: "statistics.sevenDays" },
  { value: "month", label: "statistics.month" },
];

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

type ChartPoint = { date: string } & Record<string, string | number>;

type ChartSeries = {
  key: string;
  lookupKey: string;
  label: string;
  color: string;
};

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function periodDates(period: AiUsagePeriod): string[] {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === "seven_days") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(1);
  const dates: string[] = [];
  const date = new Date(start);
  while (date <= today) {
    dates.push(localDateKey(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function numberFormatter(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
}

function shortDateLabel(dateKey: string, locale: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" })
    .format(new Date(year, month - 1, day));
}

function buildSeries(data: AiUsageStatistics): ChartSeries[] {
  const seen = new Set<string>();
  const series: ChartSeries[] = [];
  for (const row of data.byModel) {
    const lookupKey = JSON.stringify([row.providerId, row.model]);
    if (seen.has(lookupKey)) continue;
    seen.add(lookupKey);
    const index = series.length;
    series.push({
      key: `series-${index}`,
      lookupKey,
      label: `${row.providerName} · ${row.model}`,
      color: CHART_COLORS[index % CHART_COLORS.length],
    });
  }
  return series;
}

function buildChartPoints(data: AiUsageStatistics, period: AiUsagePeriod, series: ChartSeries[]): ChartPoint[] {
  const seriesKeys = new Map(series.map((item) => [item.lookupKey, item.key]));
  const points = new Map<string, ChartPoint>();
  for (const date of periodDates(period)) {
    const point: ChartPoint = { date };
    for (const item of series) point[item.key] = 0;
    points.set(date, point);
  }
  for (const row of data.daily) {
    const point = points.get(row.date);
    const key = seriesKeys.get(JSON.stringify([row.providerId, row.model]));
    if (point && key && typeof point[key] === "number") point[key] = (point[key] as number) + row.totalTokens;
  }
  return [...points.values()];
}

function UsageChart({ data, period, locale, description }: {
  data: AiUsageStatistics;
  period: AiUsagePeriod;
  locale: string;
  description: string;
}) {
  const series = useMemo(() => buildSeries(data), [data]);
  const points = useMemo(() => buildChartPoints(data, period, series), [data, period, series]);
  const chartConfig = useMemo<ChartConfig>(
    () => Object.fromEntries(series.map(({ key, label, color }) => [key, { label, color }])),
    [series],
  );
  const formatCompact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const formatTokens = numberFormatter(locale);

  return (
    <ChartContainer
      config={chartConfig}
      role="img"
      aria-label={description}
      className="h-72 w-full"
    >
      <BarChart data={points} accessibilityLayer margin={{ left: 8, right: 12, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={24}
          interval="preserveStartEnd"
          tickFormatter={(value) => shortDateLabel(String(value), locale)}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          width={48}
          tickFormatter={(value) => formatCompact.format(Number(value))}
        />
        <ChartTooltip
          cursor={false}
          content={(
            <ChartTooltipContent
              labelFormatter={(value) => shortDateLabel(String(value), locale)}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{chartConfig[String(name)]?.label ?? String(name)}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatTokens.format(Number(value))}
                  </span>
                </div>
              )}
            />
          )}
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-2" />} />
        {series.map((item) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.key}
            stackId="usage"
            fill={`var(--color-${item.key})`}
            maxBarSize={24}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function LoadingStatistics({ label }: { label: string }) {
  return (
    <div role="status" className="grid gap-4" aria-label={label}>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

export function StatisticsPage() {
  const { locale, t } = useI18n();
  const [period, setPeriod] = useState<AiUsagePeriod>("today");
  const [data, setData] = useState<AiUsageStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    getAiUsageStatistics(period)
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, retry]);

  const formatTokens = useMemo(() => numberFormatter(locale), [locale]);
  const hasUsage = (data?.total.totalTokens ?? 0) > 0;

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6" aria-labelledby="statistics-page-title">
      <PageHeader
        title={t("statistics.title")}
        titleId="statistics-page-title"
        description={t("statistics.description")}
        actions={(
          <ToggleGroup
            type="single"
            value={period}
            variant="outline"
            size="sm"
            aria-label={t("statistics.period")}
            className="flex-wrap"
            onValueChange={(value) => {
              if (value) setPeriod(value as AiUsagePeriod);
            }}
          >
            {PERIODS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {t(option.label)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />

      {loading ? <LoadingStatistics label={t("statistics.loading")} /> : loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("statistics.loadError")}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{t("statistics.loadErrorDescription")}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
              {t("statistics.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : data && hasUsage ? (
        <>
          <Card>
            <CardHeader className="gap-1 px-4 pb-3 pt-4">
              <CardTitle className="text-base">{t("statistics.chartTitle")}</CardTitle>
              <CardDescription>{t("statistics.chartDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <UsageChart data={data} period={period} locale={locale} description={t("statistics.chartDescription")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-1 px-4 pb-3 pt-4">
              <CardTitle className="text-base">{t("statistics.tableTitle")}</CardTitle>
              <CardDescription>{t("statistics.tableDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col" className="py-2 pl-0 font-medium">{t("statistics.model")}</TableHead>
                    <TableHead scope="col" className="py-2 font-medium">{t("statistics.provider")}</TableHead>
                    <TableHead scope="col" className="py-2 text-right font-medium">{t("statistics.input")}</TableHead>
                    <TableHead scope="col" className="py-2 text-right font-medium">{t("statistics.output")}</TableHead>
                    <TableHead scope="col" className="py-2 pr-0 text-right font-medium">{t("statistics.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byModel.map((row) => (
                    <TableRow key={`${row.providerId}:${row.model}`}>
                      <TableCell className="py-2.5 pl-0 font-medium">{row.model}</TableCell>
                      <TableCell className="py-2.5 text-muted-foreground">{row.providerName}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums">{formatTokens.format(row.inputTokens)}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums">{formatTokens.format(row.outputTokens)}</TableCell>
                      <TableCell className="py-2.5 pr-0 text-right font-medium tabular-nums">{formatTokens.format(row.totalTokens)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-semibold hover:bg-transparent">
                    <TableHead scope="row" colSpan={2} className="py-3 pl-0 text-left text-foreground">
                      {t("statistics.periodTotal")}
                    </TableHead>
                    <TableCell className="py-3 text-right tabular-nums">{formatTokens.format(data.total.inputTokens)}</TableCell>
                    <TableCell className="py-3 text-right tabular-nums">{formatTokens.format(data.total.outputTokens)}</TableCell>
                    <TableCell className="py-3 pr-0 text-right tabular-nums">{formatTokens.format(data.total.totalTokens)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState
          titleId="statistics-empty-title"
          title={t("statistics.noUsage")}
          description={t("statistics.noUsageDescription")}
          icon={<span className="text-lg font-semibold" aria-hidden="true">AI</span>}
        />
      )}
    </section>
  );
}
