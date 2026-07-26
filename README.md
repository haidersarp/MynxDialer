# MynxDialer

MynxDialer is a lightweight, open-source **predictive dialer** for small and
growing outbound teams. You get calling campaigns, a browser-based agent
softphone, live call supervision, and a listen-only training portal — without
needing a full-time telephony engineer to keep it running. It's built on
Node.js, React, Asterisk and MySQL, and the whole thing comes up with a single
`docker compose up`.

> ⚠️ **Telephony compliance is your responsibility.** Predictive dialing, call
> recording, and caller ID are heavily regulated (TCPA, GDPR, Ofcom, and others
> depending on where you and the people you're calling are). Only use MynxDialer
> for calls you're allowed to make, and set up consent, opt-out (DNC) and
> recording notices to match your local rules.

---

## Why use MynxDialer?

If you've looked into open-source dialing before, you've met ViciDial. It's
powerful and battle-tested — and it's also a lot. A sprawling Perl/PHP codebase,
pages of manual Asterisk configuration, its own server conventions, and a setup
that realistically assumes a dedicated Linux/telephony admin. That's the right
tool if you're running a 300-seat operation. It's overkill if you're a small
team that just wants to dial leads this week.

MynxDialer is built for the other end of that scale:

- **Up in one command.** `docker compose up` brings up the apps, the database,
  and the PBX. No hand-editing a dozen config files to get a working system.
- **A modern browser UI.** A clean React admin console and a real WebRTC
  softphone in the browser — no desk phones, no Zoiper, no dated screens for
  your agents to fight with.
- **Sensible defaults.** Migrations, seeding, dispositions, music-on-hold and
  the dialplan all work out of the box. You bring a SIP trunk; it handles the
  rest.
- **Only what a small team needs.** Predictive dialing, live monitoring, lead
  recycling, reports, and a training portal — without the enterprise sprawl you
  won't touch.

Same core idea as the big platforms; a fraction of the setup and none of the
headache.

## Architecture

Three small React apps talk to one Node backend over REST and Socket.IO. The
backend drives Asterisk over AMI to place and bridge calls, and stores
everything in MySQL. Agents' browsers connect straight to Asterisk for audio
(WebRTC), with coturn helping media through NAT.

```mermaid
flowchart TB
    subgraph browser["In the browser"]
        ADMIN["Admin console<br/>:3000"]
        AGENT["Agent softphone<br/>:3001"]
        TRAINEE["Trainee portal<br/>:3002"]
    end

    ADMIN -->|REST + Socket.IO| BE
    AGENT -->|REST + Socket.IO| BE
    TRAINEE -->|REST + Socket.IO| BE

    BE["Backend<br/>Node · Express · dialer engine<br/>:5000"]
    DB[("MySQL")]
    AST["Asterisk PBX<br/>SIP · WebRTC · ConfBridge"]
    TURN["coturn<br/>STUN / TURN"]
    CARRIER["Your carrier"]

    BE <-->|AMI| AST
    BE --> DB
    AST <--> TURN
    AST -->|SIP trunk| CARRIER
    AGENT -.->|WebRTC audio| AST
    TRAINEE -.->|listen-only audio| AST
```

- **backend** — Express API, Socket.IO, and the dialer engine that originates
  calls over Asterisk AMI, paces them predictively, and connects answered calls
  to available agents.
- **Asterisk** — the PBX: SIP registration, WebRTC for agents' browsers,
  conferences (ConfBridge), and the outbound trunk to your carrier.
- **coturn** — STUN/TURN so browsers behind NAT get working two-way audio.
- **MySQL** — all application data.

## Features

- **Predictive / power / preview dialing** with a configurable dial ratio and
  answering-machine detection (AMD).
- **Browser agent softphone** (WebRTC via Asterisk + jsSIP) — no desk phone.
- **Campaign management** — lead lists, caller-ID rotation, dispositions,
  callbacks, recycling, per-campaign scripts and calling-hour windows.
- **Live Monitor** — supervisors can Listen, Whisper, or Barge on live calls.
- **Trainee portal (listen-only)** — trainees shadow any agent with a silent
  listen line, live lead sheet, campaign script and note-taking. They *cannot*
  be heard on the call — that's enforced in the Asterisk dialplan, not just
  hidden in the UI.
- **Multi-tenant** — isolated client "accounts", each with their own agents,
  campaigns, caller IDs and DNC lists.
- **Reports** — per-agent, per-campaign and per-call, with CSV export.
- **Bring your own carrier** — configure SIP trunk(s) per account.

## Screenshots

A quick tour of the interface. Everything shown is **synthetic demo data** —
no real calls, numbers or people. The full set lives in
[`docs/screenshots/`](docs/screenshots) for reference.

### Admin console

**Dashboard** — real-time operations overview (calls, connection rate, live feed, leaderboard)

![Admin dashboard](docs/screenshots/admin-02-dashboard.png)

**Live Monitor** — supervisors Listen / Whisper / Barge on any agent's live call

![Live Monitor](docs/screenshots/admin-03-live-monitor.png)

**Leads** &nbsp;·&nbsp; **Lead Recycle** — search and manage leads; reset dispositioned leads back into the hopper

![Leads](docs/screenshots/admin-05-leads.png)
![Lead Recycle](docs/screenshots/admin-13-recycle.png)

**Reports** — per-agent / per-campaign / per-call analytics

![Reports](docs/screenshots/admin-08-reports.png)

<details>
<summary><b>More admin screens</b> — login, campaigns, lead lists, agents, dispositions, appointments, caller IDs, DNC, settings</summary>

![Admin login](docs/screenshots/admin-01-login.png)
![Campaigns](docs/screenshots/admin-04-campaigns.png)
![Lead lists](docs/screenshots/admin-06-lead-lists.png)
![Agents](docs/screenshots/admin-07-agents.png)
![Dispositions](docs/screenshots/admin-09-dispositions.png)
![Appointments](docs/screenshots/admin-10-appointments.png)
![Caller IDs](docs/screenshots/admin-11-caller-ids.png)
![DNC list](docs/screenshots/admin-12-dnc.png)
![Settings](docs/screenshots/admin-14-settings.png)

</details>

### Agent softphone

Browser-based WebRTC softphone — campaign script, lead sheet, dispositions, booked leads, and a dialpad.

![Agent login](docs/screenshots/agent-01-login.png)
![Agent workspace](docs/screenshots/agent-03-panel.png)

### Trainee portal (listen-only)

Trainees shadow any agent with a silent listen line, live lead sheet, script and note-taking.

![Trainee portal](docs/screenshots/trainee-02-panel.png)

## Quick start (local / evaluation)

You'll need Docker + Docker Compose, plus a SIP trunk from a carrier if you want
to place real calls.

```bash
git clone https://github.com/<your-account>/MynxDialer.git
cd MynxDialer

# 1. Configure
cp .env.example .env
#   → edit .env: set strong DB_PASS / MYSQL_* passwords, a long random
#     JWT_SECRET (openssl rand -hex 48), your server's public IP (EXTERNAL_IP),
#     and an AMI_SECRET that matches asterisk/conf/manager.conf.

# 2. Build & run
docker compose up -d --build

# 3. Open the apps
#   Admin   → http://localhost:3000
#   Agent   → http://localhost:3001
#   Trainee → http://localhost:3002
```

On first boot the backend runs migrations and seeds a default admin account plus
system settings. From there, set up your carrier trunk, caller IDs, a campaign
and some agents in the Admin panel.

### Trainee accounts

Create trainees from **Admin → Trainees**, or seed a batch of examples:

```bash
docker exec -i mynxdialer_backend node /app/scripts/seed_trainees.js
# prints one-time random passwords; extensions auto-assigned from 9001+
```

## Configuration notes

- **`EXTERNAL_IP`** must be your server's real public IP in production, or WebRTC
  audio won't connect. It defaults to `127.0.0.1` for local use only.
- **`asterisk/conf/manager.conf`** — the AMI `secret` there must match
  `AMI_SECRET` in `.env`.
- **TLS/WSS** — for a public deployment, terminate HTTPS/WSS at a reverse proxy
  (nginx/Caddy) in front of the apps and Asterisk's WebSocket. Browsers block
  WebRTC over self-signed certs.
- **Music on hold** ships using Asterisk's built-in free `opsound` music. To use
  your own, drop rights-cleared 8kHz / mono / 16-bit PCM `.wav` files into
  `asterisk/moh/` — see `asterisk/conf/musiconhold.conf`.
- **Never commit your `.env`, TLS keys, or generated `pjsip.conf`** — they're
  gitignored for a reason.

## Security

- Every password/secret in this repo is an obvious placeholder (`changeme`,
  `CHANGE_ME_…`). **Change all of them before putting MynxDialer on a network.**
- Keep the whole stack behind a firewall; expose only the web ports (via a
  reverse proxy with TLS) and the SIP/RTP ports your carrier needs.
- Rotate `JWT_SECRET`, and your DB and AMI credentials, for any real deployment.

## Tech stack

Node.js · Express · Socket.IO · React · jsSIP · Asterisk · coturn · MySQL ·
Docker Compose

## License

[MIT](LICENSE) © Automynx
