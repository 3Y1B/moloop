# Moloop architecture (brief)

AI coordination for Riverside volunteers. Anyone reports by voice or text, agents turn it into tasks, the right volunteer gets it, and nobody's task goes silent. Agent shape (one supervisor vs many specialists) is undecided; this doc fixes the **tools, data and rules** they work with.

## System

```mermaid
flowchart LR
    subgraph IN["Voice and text in"]
        V["Volunteer<br/>push-to-talk or typed"]
        F["Festival-goer<br/>text or voice"]
        STT["Transcribe<br/>+ 'Heard: ...' echo"]
        V --> STT
        F --> STT
    end

    subgraph AI["Agents (shape TBD)"]
        A(("Agents"))
        T["Tools<br/>create_task, assign_task, reassign_task<br/>update_progress, close_task, escalate<br/>ask_followup, answer_info<br/>propose_roster_fix, send_message"]
        A --- T
    end

    subgraph DATA["Database"]
        DB[("Volunteers + presence<br/>Teams + shifts<br/>Tasks + assignments<br/>Task events (audit)<br/>Messages + voice clips<br/>Pending approvals")]
    end

    subgraph BG["Background"]
        N["Nudge scheduler<br/>overdue or silent tasks"]
    end

    subgraph OUT["Voice and alerts out"]
        X{"Volunteer busy?"}
        TTS["Spoken message<br/>full task brief"]
        PING["Short ping<br/>'new task, check app'"]
    end

    subgraph HUM["People"]
        L["Team lead"]
        M["Mo"]
    end

    STT --> A
    T <--> DB
    T -->|"needs approval"| L
    L -->|"cross-team or critical"| M
    M -->|"approve / veto"| DB
    L -->|"approve / veto"| DB

    DB --> N
    N -->|"nudge"| X
    N -->|"still silent"| L

    T -->|"notify"| X
    X -->|idle| TTS
    X -->|busy| PING
    TTS --> V
    PING --> V
```

## Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> Open: issue reported
    Open --> Proposed: P1/P2 guest report
    Proposed --> Assigned: lead or Mo approves, or top pick after 30 s
    Open --> Queued: volunteer busy
    Open --> Assigned: P3, volunteer free
    Queued --> Assigned: volunteer frees up
    Assigned --> Accepted: "copy / on my way"
    Assigned --> Open: declined
    Accepted --> Done: "done" (owner or helper, resolves for all)

    Accepted --> Nudged: past ETA, no update
    Nudged --> Accepted: volunteer replies
    Nudged --> Quiet: still silent, lead alerted
    Quiet --> Accepted: lead says "They're fine"
    Quiet --> Assigned: lead reassigns

    Accepted --> AskedLead: "need help" (+ optional reason)
    state Escalated {
        AskedLead --> AskedMo: no response in 1/2/3 min (P1/P2/P3), or "Pass to Mo"
    }
    Escalated --> Accepted: backup (helper joins) or carry on after a call
    Escalated --> HandingOver: hand over (medics, security, 000)
    HandingOver --> HandedOver: lead taps "Arrived"
    Escalated --> Assigned: reassign (original volunteer freed)
    Escalated --> Closed: close, not needed

    Done --> [*]
    HandedOver --> [*]
    Closed --> [*]
    note right of Nudged
        Silence never closes a task.
        Urgent tasks skip to Quiet.
        Quiet is an overlay (lead_alerted_at), not a status.
    end note
    note right of Escalated
        Status stays escalated. escalation.level says who owns it
        (lead, then Mo); the lead keeps seeing it after the bump.
        A call keeps it escalated until a follow-up response.
    end note
```

Statuses are the eight in `enums.ts`; `in_progress` is unused (there is no "arrived" reply). Proposed, Nudged, Quiet, AskedLead/AskedMo and HandingOver are overlays on a status (`proposals`, `nudge_count`, `lead_alerted_at`, `escalation`). Done, HandedOver and Closed are `resolved`/`cancelled` with `resolution` set. Status copy for every screen comes from `src/lib/status.ts`.

## Tools (draft)

| Tool | Does | Human approval? |
| --- | --- | --- |
| `create_task` | Turn a report into a task: title, summary, team, priority, location | No |
| `assign_task` | Pick a volunteer (on shift, skills, nearest, least busy) or queue it | No, lead can veto |
| `reassign_task` | Move a task to someone else (declined, silent, overloaded) | Lead |
| `update_progress` | Record "copy", "on my way", "arrived", "delayed" | No |
| `close_task` | Mark done, log outcome | No |
| `escalate` | Push to team lead, then Mo | No (it only adds humans) |
| `ask_followup` | Ask the reporter or volunteer a short clarifying question | No |
| `answer_info` | Answer routine questions (toilets, times, directions) | No |
| `propose_roster_fix` | Cover no-shows, swaps, short staffing | Lead or Mo |
| `send_message` | Message a person, team or zone | Broadcasts need Mo |

Always human-only: emergency services, stage hold or evacuation, moving whole teams.

## Rules

**Voice in.** Push-to-talk (or typed). Audio is transcribed server-side, the text is echoed back ("Heard: ...") before anything happens. Short reply words are understood hands-free: *copy, on my way, done, need help*.

**Voice out.** Idle volunteers get the full task spoken. Busy volunteers (an Accepted or InProgress task) get a short ping: "new task, check the app". No acknowledgement means push again, then the team lead.

**Assignment.** One active task per volunteer; extra tasks queue. Respects shift, skills, distance and current load.

**Nudges.** A scheduler, not an LLM, checks for tasks past their ETA or silent too long: nudge, second nudge, alert lead, lead reassigns. Silence never closes a task. Urgent tasks go straight to the lead.

**Audit.** Every state change and agent decision is written to task events.

## Open

- Agent shape: one supervisor with tools vs a router plus specialist agents.
- Nudge timings (first nudge, gap, urgent skip).
- Team taxonomy: Artist, Food Vendor, Technical, Security, Logistics, Medical, Audience, Misc.
