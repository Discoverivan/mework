# mework UI layouts and AI implementation contract

> Канонический текстовый макет интерфейса mework для разработчиков и AI-агентов.
>
> Перед изменением UI агент обязан прочитать этот файл, проверить соответствующий route и компонент, а затем сохранить описанную структуру, порядок элементов и поведение. ASCII-макет здесь является wireframe, а не попыткой заменить production CSS.

## 1. Как передавать UI-макеты AI-агенту

Одного описания в стиле «сделай современно» недостаточно: оно не фиксирует геометрию, приоритеты и интерактивность. Для каждого экрана передавай четыре связанных слоя.

### 1.1. ASCII wireframe

ASCII фиксирует только пространственную структуру:

- строки — вертикальный порядок;
- отступы — визуальную вложенность;
- `│`, `─`, `┌`, `┐`, `└`, `┘` — границы областей;
- `[text]` — кнопка или control;
- `▼` — dropdown/select;
- `[ ]` — checkbox;
- `⠿` — drag handle;
- `◉` — avatar/status indicator;
- `<dynamic>` — значение из данных, не фиксированный текст;
- `...` в этом документе означает отдельные элементы вне фрагмента и **никогда не означает обрезку текста UI**.

Пример:

```text
┌──────────────────────────────┬──────────────────────────────────────────────┐
│ mework                       │                                              │
│                              │  <h1>                                        │
│ Inbox                        │                                              │
│                              │  <content>                                   │
│ Developer                   │                                              │
│   Pull Request Review       │                                              │
│                              │                                              │
│ Product                     │                                              │
│   Create task               │                                              │
│   Daily                     │                                              │
│   Planning                  │                                              │
│                              │                                              │
│ Settings                    │                                              │
│   Integrations              │                                              │
│   Team settings             │                                              │
│                              │                                              │
│ Theme  [White ▼]            │                                              │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

### 1.2. Component contract

Для каждого элемента указывай:

| Element | Semantic element | Role/name | Action | Disabled/loading rule |
|---|---|---|---|---|
| `Create task` | `button` | `Create task` | opens dialog | disabled only while unavailable |
| Team selector | select/combobox | `Team` | changes managed project | disabled while loading |
| Presenter view | `button` | `Presenter view` / `Stop presenter view` | opens or closes native window | disabled without workspace/member |
| Team disclosure | `details` or disclosure button | team name | expands member list | preserves selected team |
| Member drag handle | draggable element | `Drag <name> to reorder` | starts reorder | disabled while save runs |

Не называй визуальный контейнер «кнопкой», если он не должен быть keyboard-focusable. Не используй цвет как единственный носитель состояния.

### 1.3. State contract

Каждый dynamic screen должен явно описывать:

```text
initial/loading → ready → empty
                         ↘ error
interaction → saving/refreshing → ready | error
```

Минимально фиксируй состояния `loading`, `empty`, `error`, `selected`, `disabled` и `saving`, если они есть в flow. Для Dialog/disclosure фиксируй `open` и `closed`.

### 1.4. Data and acceptance contract

Укажи:

- источник данных и route/command;
- какие значения dynamic;
- какие значения нельзя хардкодить;
- что происходит при пустом/невалидном внешнем ответе;
- одну проверяемую positive smoke-сцену;
- визуальную проверку: порядок блоков, размеры, переносы, отсутствие clipping/ellipsis.

### 1.3. Общая компактная шапка страниц

Все top-level разделы используют `src/components/shared/PageHeader.tsx`:

- один `h1` с названием текущего раздела;
- короткий optional description под title;
- optional sync/status meta под description;
- actions справа, без отдельной строки и без визуального eyebrow/kicker;
- section labels вроде `Developer`, `Product`, `Settings` не дублируются в шапке — они остаются только в sidebar navigation;
- новые разделы не создают собственную header-разметку, а используют `PageHeader`.

Канонический размер title — 24px; общий нижний отступ — 16px. Это правило применяется также к legacy/future routes.

## 2. mework design tokens

Это baseline для новых экранов, если feature-specific token не указан в его макете.

```text
Application shell
  sidebar width:       240–260 px
  content max width:   fluid, with 32 px desktop padding
  desktop breakpoint:  1000 px
  compact breakpoint:  800 px

Spacing
  xs: 4 px   sm: 8 px   md: 12 px   lg: 16 px
  xl: 24 px  2xl: 32 px

Shape and depth
  card radius: 12–16 px
  control radius: 8–10 px
  border: 1 px semantic border token
  shadow: soft, never a heavy dark glow

Typography
  page title: 28–36 px, semibold
  section title: 18–24 px, semibold
  body: 14–16 px
  metadata: 12–14 px
  long dynamic text: wrap; no line-clamp or ellipsis unless explicitly requested

Color
  use semantic CSS variables for application UI;
  white/light theme and dark theme remain the only themes;
  statuses must have text plus color/icon/shape where useful.
```

Presenter View is the exception to shell sizing: it is a separate frameless `1280×720` Tauri window and may use feature-local presentation tokens.

## 3. Current application shell

Route-independent shell: `src/components/layout/AppShell.tsx`.

```text
┌──────────────────────────────┬──────────────────────────────────────────────┐
│ mework                       │  <active screen>                              │
│                              │                                              │
│ Inbox                        │  page content                                │
│                              │                                              │
│ DEVELOPER                    │                                              │
│   Pull Request Review       │                                              │
│                              │                                              │
│ PRODUCT                      │                                              │
│   Create task               │                                              │
│   Daily                     │                                              │
│   Planning                  │                                              │
│                              │                                              │
│ SETTINGS                     │                                              │
│   Integrations              │                                              │
│   Team settings             │                                              │
│                              │                                              │
│ Theme                       │                                              │
│ [White ▼]                   │                                              │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

Rules:

- Sidebar section headings are labels, not routes.
- Navigation order is part of the contract.
- Internal hashes/route IDs are not renamed for visual copy changes.
- `Team settings` is the user-facing name of `#settings/projects`.
- `White` and `Dark` are the only theme choices.

## 4. Inbox

Source: `src/features/inbox/InboxPage.tsx`, route `#inbox`.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Inbox                                                        [filters/actions]│
│ <short explanatory text>                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Search........................................] [filter controls]           │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ◉ <type>   <dynamic title>                              [Mark done]     │ │
│ │             <dynamic summary/metadata>                                  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ◉ <type>   <dynamic title>                              [Mark done]     │ │
│ │             <dynamic summary/metadata>                                  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                      [Load more]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

States: loading skeleton/status, empty inbox, loaded list, error alert, pagination/loading more.

## 5. Developer / Pull Request Review

Source: `src/features/developer/MyPullRequestsPage.tsx`, route `#developer/pull-requests`.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│ Pull Request Review                      [AI auto-review] [Update now] [✓✓] │
│ <dynamic loading/error/description>                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ <repo> / <PR title>                              <state/decision label> │ │
│ │ <author> · <source branch> → <target branch>                           │ │
│ │ <updated date>                                           [open/review]  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ [All] [Pending your review]                                               [⚲] │
└──────────────────────────────────────────────────────────────────────────────┘

Карточка PR состоит из decision rail, content и AI action. В author-owned `My Pull Requests` третья строка показывает `<updated>`, `Approved: <count>`, `Needs work: <count>`, `Comments: <count>`; значения приходят из native Bitbucket DTO, а не вычисляются в renderer. Слева от AI action находится кнопка `Eye`: для unread PR она называется `Mark as viewed`, после успешного native mark-read скрывается.

`Pull Request Review` и `My Pull Requests` имеют независимые переключатели `AI auto-review`: `autoReviewEnabled` запускает auto-review для reviewer PR, а `authoredAutoReviewEnabled` — только для author PR. В author PR новый commit запускает AI review, а native notification отправляется только после completed AI verdict.

`Review Results` открывает generated AI summary/comments. `Publish` отправляет general PR comment через native Bitbucket `POST`; location file/line сохраняется в опубликованном тексте. `Approve` и `Needs Work` отправляют native participant `PUT` со статусом `APPROVED`/`NEEDS_WORK`; после успешного ответа decision icon и quick-filter state обновляются в карточке.

┌──────────────────────────────────────────────┐
│ Pull Request Review settings                 │
│ Repository whitelist                         │
│ [<repo chip> ...]                            │
│ Creator whitelist                            │
│ [<creator chip> ...]                         │
│                              [Cancel] [Save] │
└──────────────────────────────────────────────┘
```

## 6. Product / Create task

Source: `src/features/product/CreateTaskPage.tsx`, route `#product/create-task`.

Create task states:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│ Create task                                      [Team ▼] [Create task]       │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ✦ AI is thinking…                                                        │ │
│ │   Building summary and description                                       │ │
│ │   <summary skeleton>                                                     │ │
│ │   <description skeleton>                                                 │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ AI draft                                            <editable fields>     │ │
│ │ Summary              [<editable summary>]                                │ │
│ │ Description          [<editable description>]                            │ │
│ │ Epic link            [No epics available ▼]                              │ │
│ │ Sprint               [<team sprint> ▼]                                    │ │
│ │ Assignee             [<Jira team member> ▼]                              │ │
│ │ [Delete]                                                     [Create]     │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- Do not seed demo/example cards in the initial state.
- The modal contains one large textarea and `Create with AI` starts the native AI draft command.
- While the command is pending, show a visible skeleton card; after success show editable `summary`, `description`, `epic link`, `sprint`, and `assignee` fields.
- Saved team Epic link JQL supplies the Epic link options; the selector remains empty when no JQL is configured or no issues match.
- The header team selector matches Daily and reloads that team's configured members, sprints, and Epic candidates; inactive members are omitted.
- The draft Assignee selector always contains `Unassigned` first by default and renders available avatar/name data.
- Sprint options come from the selected team's usable Jira sprints; the configured default sprint is selected for new cards.
- Cards, edited fields, statuses, and the selected team are persisted locally and restored when returning to this route. Pending AI generation resumes; an interrupted Jira create is returned to editable review without an automatic retry.
- `Delete` clears the draft locally. `Create` sends the edited draft through the native Jira mutation and shows the returned issue key/link.
- AI generation uses only the task `summary` and actionable `description` rules from `alfa-coreapi-jira-task`; it does not invent assignee, epic link, estimates, or priority.

## Developer / Command Board

Source: `src/features/developer/CommandBoardPage.tsx`, route `#developer/command-board`.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Command Board                                                  [Add command] │
│ Быстрый запуск локальных скриптов и команд                                  │
│ ┌─────────────────────────┐  ┌─────────────────────────┐                    │
│ │ ◉                 [...] │  │ ◉                 [...] │                    │
│ │ Restart gateway         │  │ Start stubs              │                    │
│ │ /path/script.command    │  │ /path/script.command    │                    │
│ │ /usr/bin/open ...       │  │ /usr/bin/open ...       │                    │
│ └─────────────────────────┘  └─────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- The complete card is clickable and starts the configured direct process; keyboard Enter/Space has the same behavior.
- Overflow menu contains the `Card color` dropdown (`Default`, `Blue`, `Green`, `Yellow`, `Orange`, `Red`, `Purple`, `Pink`), plus `Edit` and `Delete`; color changes save immediately and delete requires confirmation.
- Card color uses the UI palette tokens and is persisted with command metadata; legacy cards without a color use `Default`.
- Add/edit captures name, a read-only selected script file, extra arguments, and optional working directory.
- New commands open the selected script in the platform terminal through a native OS-specific launcher; `.sh`, `.bash`, `.py`, `.ps1`, `.bat`, `.cmd`, and shebang-based scripts use their matching interpreter when available.
- Command metadata is persisted locally; script contents and credentials are never copied into the database.

### Native application lifecycle

- Closing the main window hides it instead of terminating the process.
- Tray icon uses the bundled application icon and exposes `Open mework` and `Quit mework`.
- Background health/PR loops remain alive while the window is hidden; `Quit mework` is the explicit full shutdown action.

## 7. Product / Daily

Source: `src/features/daily/DailyPage.tsx`, route `#product/daily`.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│ Daily                                      [Team ▼] [Refresh statuses]       │
│ <short description>                          [Presenter view]                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Example Project · Active sprint: <dynamic sprint>                                   │
├──────────────────────────────┬───────────────────────────────────────────────┤
│ TEAM MEMBERS                 │ <selected Alias>'s sub-tasks                  │
│                              │ Assigned work in <dynamic sprint>             │
│ BACKEND                      │                                               │
│ ┌──────────────────────────┐ │ ┌───────────────────────────────────────────┐ │
│ │ ◉  <Alias>               │ │ │ <summary>                                  │ │
│ └──────────────────────────┘ │ │ <status label>                             │ │
│                              │ │ <story points>                             │ │
│ FRONTEND                     │ └───────────────────────────────────────────┘ │
│ ┌──────────────────────────┐ │ ┌───────────────────────────────────────────┐ │
│ │ ◉  <Alias>               │ │ │ <summary>                                  │ │
│ └──────────────────────────┘ │ │ <status label>                             │ │
│                              │ │ <story points>                             │ │
│ QA                           │ └───────────────────────────────────────────┘ │
│ ┌──────────────────────────┐ │                                               │
│ │ ◉  <Alias>               │ │                                               │
│ └──────────────────────────┘ │                                               │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

Rules:

- Team dropdown is in the upper-right header controls.
- `Refresh statuses` is immediately left of `Presenter view`.
- Sprint/project context is shown once above both columns, not repeated per member.
- Left column is narrow; member names are readable but compact.
- Right column is wide; task summaries wrap and are never clipped.
- Members are ordered by persisted `displayOrder`.
- Display name is `alias || displayName`.
- Avatar loads through the native authenticated Jira proxy; initials are fallback.
- Status is a textual label with tone: backlog gray, progress blue, done/closed green, blocked red, review purple.
- Initial load is full workspace; periodic/force refresh updates only current sprint issues.

## 8. Daily Presenter View

Source: `src/features/daily/PresenterView.tsx`, route `#product/daily/presenter`, native label `daily-presenter`.

Canvas: frameless `1280×720`, 16:9.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔴 Daily                         <project/team>              <date> [Refresh][Stop]│
├──────────────────────────────────────────────────────────────────────────────┤
│        ◯                         <Alias>                                     │
│                                  STORY POINTS                                 │
│                                  <completed> / <planned> SP                  │
│                                  ━━━━━━━━━━━━━━━░░░░░░░░░░ <percent>          │
│                                                                              │
│ ┌──────────────────────┬──────────────────────┬──────────────────────┬──────┐ │
│ │ <TICKET-ID>  [STATUS]│ <TICKET-ID>  [STATUS]│ <TICKET-ID>  [STATUS]│ ...  │ │
│ │ <full summary>       │ <full summary>       │ <full summary>       │      │ │
│ │                  <SP>│                  <SP>│                  <SP>│      │ │
│ └──────────────────────┴──────────────────────┴──────────────────────┴──────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- No `TODAY'S FOCUS`, task count, project code, parent labels, update dates, comments, graphs, watermark, browser chrome or decorative illustrations.
- Cards are white, radius about 16 px, soft shadow, thin gray-blue border.
- Status pill is on the top right; ticket ID is on the top left; SP is aligned bottom-right.
- Long summaries wrap naturally. Never use line clamp, ellipsis or hidden overflow for summaries.
- Project/date/navigation remain visually secondary to the selected member and tasks.
- Presenter state is synchronized from the main Daily window.

## 9. Product / Planning

Sources: `src/features/planning/PlanningPage.tsx`, `PlanningWorkspace.tsx`, route `#product/planning`.

Entry screen:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Product                                                                      │
│ Planning                                                                    │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ What do you want to plan?                                                │ │
│ │ Managed project       [<team/project> ▼]                                 │ │
│ │ Target sprint         [<sprint> ▼]                                        │ │
│ │                                                   [Open planning]        │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Workspace:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ <team> planning                                      [Save draft] [Apply and lock]│
├───────────────────────────────────────┬──────────────────────────────────────┤
│ Planning source · <sprint>             │ Target sprint · <sprint>              │
│ [issue cards]                         │ [issue cards + subtask rows]         │
│                                       │                                       │
│                    [Add selected to target]                                  │
└───────────────────────────────────────┴──────────────────────────────────────┘
```

`Apply and lock` requires an explicit confirmation dialog. Locked workspaces show `Locked` instead of write actions.

## 10. Settings / Integrations

Source: `src/features/settings/SettingsPage.tsx`, route `#settings/integrations`.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Integrations                                                                 │
│                                                                              │
│ Connected integrations                                                       │
│ Choose an integration to configure its connection.                         │
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Jira                                      <health status>                 │ │
│ │ Track Jira issues and project activity.                                  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Bitbucket                                 <health status>                 │ │
│ │ Connect repositories and pull request activity.                           │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Provider dialog:

```text
┌──────────────────────────────────────────────┐
│ <Jira|Bitbucket> integration                  │
│ Base URL       [https://<host>.............] │
│ Personal access token [write-only..........] │
│ [ ] Allow insecure TLS                       │
│                              [Cancel] [Save] │
└──────────────────────────────────────────────┘
```

Credentials are write-only. Never place tokens in the wireframe, DOM text, logs, error messages or screenshot fixtures.

## 11. Settings / Team settings

Source: `src/features/settings/planning-projects/ManagedProjectsSettings.tsx`, route `#settings/projects`.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Team settings                                                                │
│                                                                              │
│ Managed Jira projects                                             [Add team]│
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ <team/project name>                              [Delete]                │ │
│ │ <project key> · <Jira integration>                                      │ │
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ ▼ <team/project name>                                                     │ │
│ │   Task creation settings                                                   │ │
│ │   Default sprint for task creation [<sprint> ▼]                            │ │
│ │   Epic link JQL [.................................] [Check]                │ │
│ │                                      [Save task creation settings]          │ │
│ │   Team members                                      [Add team member]       │ │
│ │   ┌────────────────────────────────────────────────────────────────────┐  │ │
│ │   │ ⠿  ◉  <Alias>   <full Jira name>   Role: <role>       [Delete]     │  │ │
│ │   └────────────────────────────────────────────────────────────────────┘  │ │
│ │   ┌────────────────────────────────────────────────────────────────────┐  │ │
│ │   │ ⠿  ◉  <Alias>   <full Jira name>   Role: <role>       [Delete]     │  │ │
│ │   └────────────────────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Add team dialog:

```text
┌──────────────────────────────────────────────┐
│ Add team                                     │
│ Connect a Jira team and choose its board.   │
│ Project name   [..........................]  │
│ Jira key       [..........................]  │
│ Jira board     [Load boards] [<board> ▼]    │
│                              [Cancel] [Save]│
└──────────────────────────────────────────────┘
```

Member interaction contract:

- Team card itself is the disclosure container; do not render a second unrelated team card below it.
- Clicking the team header toggles the member list in the same card.
- `⠿` is the visible drag handle; the member card is the draggable item and the list row is the drop target.
- Use native HTML drag events with `dataTransfer.effectAllowed = "move"` and `dropEffect = "move"`.
- Persist the final account ID order through `planning_team_member_reorder`.
- Alias is the display name; Jira account ID and full Jira name remain identity data.
- Search starts at 3 characters.
- Avatar uses native Jira proxy; first/last initials are fallback.
- The only member removal label is `Delete`.
- Task creation settings are per team: the default sprint initializes new Create task cards.
- Epic link JQL is read-only checked through `planning_epic_link_jql_preview`; the popup lists Jira issue KEY and summary.
- Saved Epic link JQL populates the Create task Epic link choices; selected sprint, epic and assignee are sent with the selected managed project.

## 12. Agent implementation checklist

Before editing:

- [ ] Read this file and the route/component named by the screen.
- [ ] Identify the existing UI primitive before adding a new one.
- [ ] Identify data source, loading/error/empty states and write boundary.
- [ ] Confirm whether the requested change is visual copy, layout, behavior or data contract.

While editing:

- [ ] Preserve route IDs, Tauri command names and provider contracts unless explicitly changed.
- [ ] Use semantic elements and accessible names.
- [ ] Keep dynamic values dynamic; do not replace them with screenshot examples.
- [ ] Do not leak credentials or Authorization headers.
- [ ] Preserve full text and wrapping unless truncation is explicitly requested.
- [ ] Keep changed feature styles local where possible.
- [ ] For reorder UI, test both DOM drag events and persisted resulting order.

After editing:

- [ ] Run the focused positive smoke test.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Run Rust tests/clippy when backend/contracts/commands changed.
- [ ] Run `git diff --check`.
- [ ] If a visual requirement cannot be proven by tests, launch the app only for a planned `computer_use` check and verify the named controls directly.
- [ ] Report separately: implemented behavior, automated evidence, visual evidence and remaining limitations.

## 13. Sources and rationale

The following sources informed this format:

- [Figma MCP for designers](https://www.figma.com/resource-library/mcp-for-designers/) — structured design properties, components and tokens are more useful to agents than a screenshot alone.
- [Storybook](https://storybook.js.org/) — build, test and document components in isolation; interaction and visual states should be explicit.
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — semantic roles, states and keyboard behavior belong in the component contract.
- [MDN HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) — custom drag operations require an explicit `DataTransfer` contract and drop handling.
- [Atlassian Design System](https://atlassian.design/components) and [design tokens](https://atlassian.design/components/tokens/all-tokens) — reusable components and named tokens keep layout decisions consistent.

### Recommended handoff order

When a screen is substantially redesigned, provide artifacts in this order:

```text
1. ASCII wireframe        → regions, order, alignment, column proportions
2. Component contract    → semantics, roles, accessible names, actions
3. State matrix           → loading, empty, error, selected, saving
4. Data contract          → dynamic fields, source, fallback, write boundary
5. Tokens                 → spacing, type, radius, color, responsive rules
6. Visual reference       → Figma/preview/screenshot, if available
7. Acceptance checks      → focused test + visual verification steps
```

ASCII should remain in the repository next to the implementation, while Figma/Storybook/preview assets can serve as higher-fidelity references when exact visual styling matters.
