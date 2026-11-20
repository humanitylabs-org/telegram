---
name: tg-style
description: Use when the owner asks about the Telegram look for his chats.
version: 0.8.23
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

With switch `catch-me-up` on, the Ready folder's button reads Catch me up and covers every app, not just Ready. It saves the Ready chats and unread notifications he had and opens a new chat starting "Catch me up (cu_…)". The goal is one short overview, then a quick interactive pass he can stop at any time. Never one giant message.

1. Call `catchup_list` with the id from the first message (directly, no tool search). It returns `chats` (Ready), `notes` (unread notifications) and `previous` (the last catch-up's time, what it showed and what he decided). Leave out other catch-up and sweep chats.
2. Gather what waits on him, in parallel, from each installed app's own tools (skip an app that isn't installed or errors, and say so in one line): Ready chats (check them as Ready sweep steps 1 to 4 say), Messenger (`messenger_chats_needing_draft`, plus `messenger_list_drafts` for drafts he hasn't sent), WizardOS Tracker (his Human review items, builder questions asked of him, approvals for him, goals he owns with an old status; give each card's link), Money (`money_overview`: banks needing him, transactions to review), Mail (`mail_list` unread, inbox only; real people and things to act on, not newsletters), Second Hand (`secondhand_items`: what needs the owner), Card Benefits (`benefits_overview`: tasks and refunds waiting, benefits about to lapse), and the saved unread notifications.
3. Mark each item new or still waiting by comparing with `previous.recorded` (key = source plus that app's id, e.g. `chat:<id>`, `messenger:<chat id>`, `tracker:<owner/repo#n>`). FYI-only things (notifications, finished chats, money changes) show only if new since last time. Things he held last time stay. With no previous catch-up, everything is new.
4. First reply: the overview only. One line per app that has something ("Messenger: 3 to reply, 1 new"), quiet apps folded into one "Nothing waiting in …" line, the time since the last catch-up, and the first chunk. Keep it to one screen.
5. Then work in chunks labelled A, B, C as in Ready sweep step 6 (smallest effort first, new before old, one numbered line per item with the link and your suggestion, plain lines). He answers "A yes", "B2 archive", "C1 go", "hold", "just Messenger" or "stop".
6. Act only on his answer, with each app's own tools and the Ready sweep rules for chats. Messenger replies are drafts he sends himself; never send, pay, approve or archive anything he has not said yes to.
7. Call `catchup_record` with every item shown and its decision (`open`, `done`, `archived`, `held`, `sent`, `skipped`) once the overview is out, and again whenever decisions change. That is what the next catch-up compares against. "Fresh catch me up" means ignore `previous`.
8. Finish with what is still waiting per app, and offer to archive the catch-up chat itself.
