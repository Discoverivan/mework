import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent, MouseEvent } from "react";
import type { TeamMember } from "../../shared/contracts/planning";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

interface TeamMemberPickerProps {
  members: TeamMember[];
  selectedAccountId?: string;
  competency?: string;
  disabled?: boolean;
  onAssign: (accountId: string | undefined) => void;
}

export function TeamMemberPicker({
  members,
  selectedAccountId,
  competency,
  disabled = false,
  onAssign,
}: TeamMemberPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = members.find((member) => member.accountId === selectedAccountId);
  const normalizedCompetency = competency?.toLowerCase();
  const visibleMembers = useMemo(() => {
    const filtered = members.filter((member) => {
      const isSelected = member.accountId === selectedAccountId;
      const tagMatch = !normalizedCompetency || member.tags.some((tag) => tag.toLowerCase() === normalizedCompetency);
      const textMatch = !query || `${member.displayName} ${member.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase());
      return (member.active || isSelected) && (tagMatch || isSelected) && textMatch;
    });
    return filtered.sort((a, b) => (a.accountId === selectedAccountId ? -1 : b.accountId === selectedAccountId ? 1 : a.displayName.localeCompare(b.displayName)));
  }, [members, normalizedCompetency, query, selectedAccountId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, competency]);

  function choose(member: TeamMember) {
    onAssign(member.accountId);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleMembers.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && visibleMembers[activeIndex]) {
      event.preventDefault();
      choose(visibleMembers[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative min-w-[12rem]">
      <Input
        ref={inputRef}
        role="combobox"
        aria-label="Assign team member"
        aria-expanded={open}
        aria-controls="planning-member-options"
        placeholder={selected?.displayName ?? "Assign member"}
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={handleKeyDown}
        onDragOver={(event: DragEvent<HTMLInputElement>) => event.preventDefault()}
        onDrop={(event: DragEvent<HTMLInputElement>) => {
          event.preventDefault();
          const accountId = event.dataTransfer.getData("text/planning-account-id");
          if (members.some((member) => member.accountId === accountId)) onAssign(accountId);
        }}
      />
      {open ? (
        <div id="planning-member-options" role="listbox" className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          {visibleMembers.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No matching team members.</p> : null}
          {visibleMembers.map((member, index) => {
            const outsideTeam = Boolean(normalizedCompetency) && !member.tags.some((tag) => tag.toLowerCase() === normalizedCompetency);
            return (
              <Button
                key={member.accountId}
                type="button"
                variant={index === activeIndex ? "secondary" : "ghost"}
                className="w-full justify-start"
                role="option"
                aria-selected={member.accountId === selectedAccountId}
                draggable
                onDragStart={(event: DragEvent<HTMLButtonElement>) => event.dataTransfer.setData("text/planning-account-id", member.accountId)}
                onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                onClick={() => choose(member)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-5 w-5 rounded-full" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                  <span>{member.displayName}</span>
                </span>
                <span className="ml-auto flex gap-1">
                  {member.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  {outsideTeam ? <Badge variant="outline">Outside selected team</Badge> : null}
                </span>
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
