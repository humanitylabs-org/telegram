---
name: telegram
description: Use when the owner asks about the Telegram look for his chats.
version: 0.8.21
author: Oscar (Hermes Agent)
license: GPL-3.0-only
platforms: [linux, macos]
metadata:
  hermes:
    tags: [chats, look]
    related_skills: []
---
# Telegram Style

A Chats view: the owner's Wizard chats drawn like Telegram (chat list with folders, avatars, badges, archived chats, search; Telegram bubbles in threads). It reads the same threads as Chats; the only thing it keeps is the words of voice messages, heard once by the Transcriber app. Long replies open on their short answer, tap to see all. It does not change the built-in Chats; picking it as the default Chats is the owner's choice in Settings. `wizard_echo` proves the app is reachable.

## Ready sweep

The Sweep button in the Ready folder (switch `ready-sweep`) saves the Ready list the owner saw and opens a new chat starting "Sweep my Ready list: N chats (sw_…)". In that chat, help him clear the list in bulk, the way a backlog review works: you sort, he decides with one-word replies.

1. Call this app's `sweep_list` with the sweep id from the first message. Before planning, drop any chat that has since been archived or is running again (check each id on the Hermes sessions API: `GET /api/sessions/<id>`, key and port are API_SERVER_KEY / API_SERVER_PORT in ~/.hermes/.env; never print the key).
2. Know what each chat is waiting on. The saved ask and preview usually say it; when they are vague, read that chat's last assistant message (`GET /api/sessions/<id>/messages?order=newest&limit=3`). Never describe a chat you have not read.
3. Group into chunks that make sense and label them A, B, C, smallest effort first: finished or FYI chats that only need archiving; things he should try or look at (with the link or step); decisions only he can make (your recommendation plus the reply words); failed or stuck chats (offer a retry); old or duplicate chats. Within a chunk, number every chat on one line: title, what it waits on, your suggestion. Numbered lines are fine here so he can answer "A yes", "B2 archive", "C1 go", "hold".
4. Act only on his answer, then say what changed and how many are left. Archive with `PATCH /api/sessions/<id>` body `{"archived": true}` (reversible: `false` restores). To pass his decision to a chat's own agent, start a run there with `POST /v1/runs` body `{"session_id": "<id>", "input": "<his words>"}` and tell him it went. "Hold" or "skip" leaves the chat in Ready; bring held ones back at the end.
5. Never archive, answer or retry anything he has not said yes to, and never touch chats outside the sweep list. Finish with the count still in Ready.
