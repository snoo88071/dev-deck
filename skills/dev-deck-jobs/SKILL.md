---
name: dev-deck-jobs
description: Create, change or find Windows scheduled tasks (Task Scheduler) that run a project's scripts on a schedule — "every day at 7", "every 48 hours", a nightly backup, a daily scrape, a weekly report — so they stay findable in Dev Deck, using the Dev Deck MCP tools. Use it before registering a task with Register-ScheduledTask or schtasks; when the user asks what runs on a schedule, where a job went, or why a scheduled script didn't run; and when a script you wrote should run by itself at intervals on Windows.
---

# Scheduled tasks that stay findable

A script put on a schedule keeps running long after the session that wrote it
is gone. Months later the user doesn't remember it exists, or where it lives,
and a task whose folder was moved fails every day without anyone noticing.
Dev Deck shows these tasks grouped by project (Scheduled page) and flags the
broken ones in Cleanup, as long as a task can be tied to its project.

## Before creating one

Call `dev_jobs` (scope `session`; `all` if the script could belong elsewhere).
If a task already runs the same script, change that one instead of adding a
second: two tasks doing the same job is how duplicates and double runs start.

Only create a task the user asked for, or agreed to when you proposed it.

## How to create it

So that Dev Deck ties it to its project and the user can find it:

- **The script lives in the project** (e.g. `scripts\nightly.ps1`), not in a
  temp folder or the user's profile.
- **Working directory = the project folder.** That is how Dev Deck groups it.
- **Task folder `\Dev Deck\`**, a name that says project and job
  (`acme-shop nightly backup`), and a description of what it does, written
  for someone who has forgotten.
- **The environment is not the terminal's.** A task doesn't inherit PATH or
  variables set in a shell: the script reloads what it needs (e.g.
  `[Environment]::GetEnvironmentVariable('API_KEY', 'User')`) or uses full paths.
- **A log in the project** (e.g. `data\logs\`), trimmed to the last few dozen,
  so a failed run can be read later.
- **No flashing window:** `powershell -WindowStyle Hidden`, `pythonw.exe`, or
  `conhost.exe --headless node script.js`.
- **`-StartWhenAvailable`**, so a run missed while the PC was off happens at
  the next start.

```powershell
$project = 'C:\path\to\acme-shop'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$project\scripts\nightly.ps1`"" `
  -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At 7am            # every 48 h: -Daily -DaysInterval 2
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskPath '\Dev Deck\' -TaskName 'acme-shop nightly backup' `
  -Description 'acme-shop: dumps the dev database to backups\, keeps the last 14. Created by Claude Code.' `
  -Action $action -Trigger $trigger -Settings $settings
```

This needs no administrator rights. Weekly: `-Weekly -DaysOfWeek Tuesday,Friday -At 9am`.

## After creating it

Run it once (`Start-ScheduledTask -TaskPath '\Dev Deck\' -TaskName '...'`),
then check `dev_jobs`: the last run should say `succeeded`. If it failed, the
outcome says why (exit code, missing folder...). Fix it before telling the user
it's done.

Tell the user, in two lines: what runs, when, and that it's in Dev Deck under
Scheduled (and in the Windows Task Scheduler under `\Dev Deck\`).

## Never

- Delete or disable a task yourself: `dev_jobs` is read only on purpose. Tell
  the user, who does it from Dev Deck (Scheduled or Cleanup page), where a
  deleted task leaves a copy of its definition.
- Register a task under `\Microsoft\`, or one that runs as another user or
  with highest privileges, unless the user asked for exactly that.
- Put secrets in the task's arguments: they are readable by anyone who opens
  the Task Scheduler.

If the Dev Deck tools are missing, the rules above still hold: without
`dev_jobs`, look first with
`Get-ScheduledTask -TaskPath '\Dev Deck\'`.
