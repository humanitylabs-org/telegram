---
name: tg-style
description: Use when the owner asks about the Telegram look for his chats.
version: 0.8.25
author: Oscar (Hermes Agent)
license: GPL-3.0-only
platforms: [linux, macos]
metadata:
  hermes:
    tags: [chats, look]
    related_skills: []
---
# TG style (app id tg-style, formerly telegram)

A Chats view: the owner's Wizard chats drawn like Telegram (chat list with folders, avatars, badges, archived chats, search; Telegram bubbles in threads). It reads the same threads as Chats; the only thing it keeps is the words of voice messages, heard once by the Transcriber app. Long replies open on their short answer, tap to see all. It does not change the built-in Chats; picking it as the default Chats is the owner's choice in Settings. `wizard_echo` proves the app is reachable.

## Ready sweep

The Sweep button in the Ready folder (switch `ready-sweep`) saves the Ready list the owner saw and opens a new chat starting "Sweep my Ready list: N chats (sw_…)". In that chat, help him clear the list in bulk, the way a backlog review works: you sort, he decides with one-word replies.

1. Call this app's `sweep_list` with the sweep id from the first message (call it directly, no tool search needed). Leave out other "Ready sweep" chats. Before planning, drop any chat that has since been archived or is running again.
2. Hermes sessions API: `http://127.0.0.1:8642` (API_SERVER_PORT is usually not set in ~/.hermes/.env; 8642 is the default), header `Authorization: Bearer $API_SERVER_KEY` from that file, never printed. `GET /api/sessions/<id>` returns `{session: {...}}`; messages are `GET /api/sessions/<id>/messages?order=latest&limit=8`, rows under `data` (order is `oldest` or `latest` only).
3. Read each chat's last full assistant reply, and its last user message, before describing it. Its status line's `items` list every open ask in that chat: report every one, not only the first. Never describe a chat you have not read.
4. Check the owning source before calling something open, sent or stuck: a Messenger draft "to send" (`messenger_list_drafts`: no draft left usually means he sent it), an app change (installed version in `~/runtipi/apps/wizardapps/<app>/config.json`), a chat cut off by a restart (read further back: the work may have shipped before the cut). Say what you checked in a few words.
5. When two chats share a topic (two drafts to the same person), tell them apart by what each one says and its time, not by title order, and say which is newer.
6. Group into chunks labelled A, B, C, smallest effort first: finished or FYI (archive); things to try or send (with the link); decisions only he can make (your pick plus reply words); failed or stuck (offer a retry). Within a chunk, number every chat on one line: title and date, what it waits on, your suggestion. Plain lines, no bold headings. Numbered lines are fine here so he can answer "A yes", "B2 archive", "C1 go", "hold".
7. Act only on his answer, then say what changed and how many are left. Archive with `PATCH /api/sessions/<id>` body `{"archived": true}` (reversible: `false` restores). To pass his decision to a chat's own agent, start a run there with `POST /v1/runs` body `{"session_id": "<id>", "input": "<his words>"}` and tell him it went. "Hold" or "skip" leaves the chat in Ready; bring held ones back at the end.
8. Never archive, answer or retry anything he has not said yes to, and never touch chats outside the sweep list. Finish with the count still in Ready, and offer to archive the sweep chat itself.

## Catch me up

With switch `catch-me-up` on, the Ready folder's Sweep button becomes Catch me up. A tap saves his Ready chats and unread notifications and starts a new chat in the background starting "Catch me up (cu_…)"; he stays in the list, sees it as Working, and it lands in Ready when your overview is done. He acts there and archives it himself. Every catch-up is a fresh pull: never mention earlier catch-ups, what is new since one, or what was seen or held last time.

1. Call this app's `catchup_list` with the id from the first message (directly, no tool search). It returns `chats` (Ready) and `notifications` (unread). Leave out other "Catch me up" and "Ready sweep" chats.
2. Gather the rest from each app's own MCP tools (`mcp__wizard__<app>__*`), only for apps that are installed; skip a missing one silently. Look for: Messenger replies waiting and drafts to send (`messenger_list_drafts`), Tracker items that name him or wait on him, Money (bills, payments or transactions to look at), Mail (unread mail that needs an answer), Second Hand (listings, offers, messages), Card Benefits (offers or credits about to expire). Read Ready chats as the Ready sweep's steps 2 to 4 say before describing one. Never describe something you have not read.
3. The overview fits on one phone screen: one line per app with what waits on him there ("Mail: 2 to answer", "Messenger: 1 draft to send"). Counts, not lists.
4. Then work through it in chunks labelled A, B, C, smallest effort first, as in the Ready sweep's step 6: finished or FYI (archive or clear), things to send or try, decisions only he can make (your pick plus reply words), stuck. Number each item on one plain line so he can answer "A yes", "B2 send", "C1 go", "hold". Act only on his answer, through the owning app, and say what changed and what is left.
5. Never send, archive, pay, reply or retry anything he has not said yes to. Finish with what is still waiting.
