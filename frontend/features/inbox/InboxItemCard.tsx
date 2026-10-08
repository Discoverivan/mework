import { useState } from "react";
import type { InboxItem } from "../../shared/contracts/inbox";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n/context";

interface InboxItemCardProps {
  item: InboxItem;
  onMarkDone: () => Promise<void> | void;
}

function severityVariant(severity: string) {
  if (severity === "high") return "destructive" as const;
  if (severity === "medium") return "secondary" as const;
  return "outline" as const;
}

export function InboxItemCard({ item, onMarkDone }: InboxItemCardProps) {
  const { t } = useI18n();
  const [markingDone, setMarkingDone] = useState(false);
  const titleId = `inbox-item-title-${item.id}`;

  async function handleMarkDone() {
    setMarkingDone(true);
    try {
      await onMarkDone();
    } finally {
      setMarkingDone(false);
    }
  }

  return (
    <Card
      aria-labelledby={titleId}
      className={`inbox-item ${item.read ? "is-read" : "is-unread"}`}
      role="article"
    >
      <CardHeader>
        <CardDescription className="item-meta">
          {item.source} · {item.project} · {item.externalId}
        </CardDescription>
        <CardTitle id={titleId} className="text-lg">
          {item.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p>{item.reason}</p>
        <div className="item-badges" aria-label={t("inbox.itemDetails")}>
          <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
          <Badge variant="outline">{item.actionKind}</Badge>
        </div>
      </CardContent>
      <CardFooter className="item-actions">
        <Button asChild variant="link" size="sm">
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
            {t("inbox.openSource")}
          </a>
        </Button>
        {!item.done ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={markingDone}
            aria-busy={markingDone}
            onClick={() => void handleMarkDone()}
          >
            {markingDone ? t("inbox.markingDone") : t("inbox.markDone")}
          </Button>
        ) : (
          <Badge variant="secondary">{t("inbox.done")}</Badge>
        )}
      </CardFooter>
    </Card>
  );
}
