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
        <div className="item-badges" aria-label="Item details">
          <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
          <Badge variant="outline">{item.actionKind}</Badge>
        </div>
      </CardContent>
      <CardFooter className="item-actions">
        <Button asChild variant="link" size="sm">
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
            Open source
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
            {markingDone ? "Marking done…" : "Mark done"}
          </Button>
        ) : (
          <Badge variant="secondary">Done</Badge>
        )}
      </CardFooter>
    </Card>
  );
}
