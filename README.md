# MuziQuiz

**Live quizzes for classrooms, workshops and events, over local Wi-Fi, with no internet and no accounts.**

One Windows laptop runs everything: the host controls, the projector screen and the player website. Players scan a QR code or type a PIN in their phone's browser. There is nothing to install for players, no sign-up, no cloud and no internet needed on event day.

## Highlights

- **Two ways to host.** Install the Windows desktop app (`MuziQuiz-Setup.exe`), or run it from source with Node.js.
- **Players use their browser.** Join by QR code, PIN or URL on the same Wi-Fi. Reconnects resume where they left off.
- **Quiz-show answer colours.** A, B, C and D keep the same colour on phones, the projector and the answer chart.
- **Speed scoring the server controls.** Correct and faster earns more points. Times are measured by the server, never by phones.
- **Animated leaderboard.** Points count up, bars grow and players slide up or down. The top 10 show first, and you can page through everyone with ← 1 2 3 → or the arrow keys.
- **Winners reveal.** When the quiz ends, the projector reveals 3rd, 2nd and then 1st on a podium, with confetti.
- **Shareable result cards.** Every player can save a picture with the event name and their rank out of N, with medals and effects for the top 3. The host can save a "Top 3" podium picture.
- **Event names.** Shown on the waiting screen and printed on every result card.
- **Fair play.** One device can't run an army of fake players, look-alike names can't impersonate others, and the "Fastest" award can't be won by skipping questions.
- **Fully offline.** No CDN, analytics or cloud database. All data stays in SQLite on the host laptop.

## Contents

1. [Quick start: Windows desktop app](#1-quick-start-windows-desktop-app)
2. [Run from source (Node.js)](#2-run-from-source-nodejs)
3. [Set up the Wi-Fi network](#3-set-up-the-wi-fi-network)
4. [Create or import a quiz](#4-create-or-import-a-quiz)
5. [Run an event](#5-run-an-event)
6. [Scoring, Fastest and ties](#6-scoring-fastest-and-ties)
7. [Fair play and security](#7-fair-play-and-security)
8. [Settings](#8-settings)
9. [Event-day checklist](#9-event-day-checklist)
10. [History, backups and updates](#10-history-backups-and-updates)
11. [Troubleshooting](#11-troubleshooting)
12. [Development](#12-development)

---

## 1. Quick start: Windows desktop app

The easiest way to host. No Node.js or terminal needed.

1. Download **`MuziQuiz-Setup-<version>.exe`** from this repository's **Releases** page, or [build it yourself](#building-the-desktop-installer).
2. Run it and choose where to install. It adds desktop and Start menu shortcuts.
   - Windows may show **"Windows protected your PC"** because the installer is not code-signed. Choose **More info → Run anyway**.
3. On first launch, **create your host password** (at least 12 characters). This only works on the host laptop itself; players on Wi-Fi can't set it.
4. When Windows Firewall asks, allow MuziQuiz on **Private networks**, otherwise phones can't connect.
5. Create a quiz, start a session, and show the QR code. Players join from their phone browser.

**App menu**

| Menu item | What it does |
| --- | --- |
| Host space | Back to the quiz library and controls. |
| Open this page in web browser | Opens the page you're on in your normal browser (Ctrl+Shift+B). The **Open in browser ↗** button at the top of the app does the same. |
| Open data folder | Opens `%APPDATA%\MuziQuiz` (database and settings). |
| Reset host password… | Forgets the password so you can create a new one. Quizzes and results are kept. |
| Full screen (projector) | F11 for the projector view. |
| Player join addresses… | Lists the Wi-Fi addresses players can open. |

The app uses port **3000**, or the next free port up to 3009. If you quit while a quiz is live, it asks first, because players would be disconnected.

> **Moving from the source version?** Before the app's first launch, copy `data\localmenti.sqlite` into `%APPDATA%\MuziQuiz\data\` to keep your quizzes, password and history. Copy any settings from your `.env` into `%APPDATA%\MuziQuiz\.env`.

## 2. Run from source (Node.js)

Requirements: Windows with **Node.js 22.13 or newer**, and internet access once to install dependencies.

```powershell
cd C:\path\to\MuziQuiz
npm install
npm run build
npm run start
```

Open **http://localhost:3000/host** on the laptop. On first visit it asks you to create the host password (you can also run `npm run setup:host` in a terminal). Players use the laptop's Wi-Fi address instead of `localhost`.

**Windows shortcut:** double-click **`start-muziquiz.cmd`**. It stops any previous MuziQuiz server on the same port, starts a fresh one, and opens the browser when it's ready. Keep that window open during the event; close it or press Ctrl+C to stop.

## 3. Set up the Wi-Fi network

1. Connect the laptop and the players' phones to the **same trusted Wi-Fi or LAN**. Avoid guest networks with "client isolation".
2. Start MuziQuiz. When you start a session, choose the adapter players are on (for example `Wi-Fi · 192.168.1.4`). The lobby shows that address and a QR code.
3. Test from one phone: `http://<laptop-ip>:3000/join`.

**Windows Firewall:** set the event network to the **Private** profile and allow MuziQuiz on Private networks. The desktop app asks automatically. For the source version, an administrator can add a rule:

```powershell
New-NetFirewallRule -DisplayName "MuziQuiz LAN TCP 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet
```

Don't disable the firewall globally, and don't expose MuziQuiz to the internet (no port forwarding or tunnels).

**Capacity:** a session allows up to 200 players. Real capacity depends on your Wi-Fi access point; for big rooms, use a proper access point (not a phone hotspot) and Ethernet between the laptop and router.

## 4. Create or import a quiz

In the host space, choose **＋ Create quiz**:

- **Answer time** applies to every question: **5–120 seconds**. There is a separate 3–5 second reading time before options appear.
- Up to **100 questions**, each with **2–6 choices**.
- **Scored questions** have one correct choice and 1–10,000 maximum points (default 1,000).
- **Polls** have no correct choice and award no points.
- Edits save automatically. **Save quiz & return** takes you back to the library.

### Import JSON, or write a quiz with AI

**Import JSON** accepts a file or pasted text. **Copy AI prompt** copies a ready-made prompt: fill in the topic, audience and number of questions, paste it into any AI chat, and paste the answer back. The AI is asked to return the JSON in one ```` ```json ```` code block, and MuziQuiz accepts that code block as-is. MuziQuiz itself never contacts an AI service. Always check the facts.

Only **version 2** files up to **512 KiB** are accepted:

```json
{
  "version": 2,
  "quiz": {
    "title": "Space basics",
    "description": "A short warm-up",
    "durationSeconds": 20,
    "questions": [
      {
        "type": "quiz_mcq",
        "text": "Which planet is called the Red Planet?",
        "options": [
          { "id": "a", "text": "Venus" },
          { "id": "b", "text": "Earth" },
          { "id": "c", "text": "Mars" },
          { "id": "d", "text": "Jupiter" }
        ],
        "correctOptionId": "c",
        "basePoints": 1000,
        "explanation": "Iron oxide gives Mars its red appearance."
      }
    ]
  }
}
```

For a poll, use `"type": "poll_mcq"`, `"correctOptionId": null` and `"basePoints": 0`. `durationSeconds` (5–120) belongs to the quiz, not to individual questions. Limits: title 120 characters, question text and explanations 2,000, choices 300.

## 5. Run an event

1. **Start a session.** In the library, choose the quiz, the players' Wi-Fi adapter and the reading time. Optionally type an **Event name**, for example "Friday Science Night – Room 4"; it appears on the waiting screen and on every result card.
2. **Open the lobby.** Click **Open session** and put it on the projector (F11 for full screen). It shows the event name, the join address, the PIN and a QR code, and players appear as they join.
3. **Players join** at `/join` or by scanning the QR code. Opening a QR link fills in the PIN, but they can still change it. Nicknames are 1–24 letters or numbers in one alphabet; duplicates get a number added.
4. **Play.** For each question, players read first, then the coloured answer buttons appear and the timer starts. One tap locks the answer. Then the host closes answering, reveals the answer and the answer chart, and optionally shows the **leaderboard**.
5. **Leaderboard.** Points count up, bars grow, then players move up or down. The **top 10** show first; use **← 1 2 3 →** or the **arrow keys** (a presentation clicker works) to page through everyone. **Replay reveal** plays the animation again.
6. **Finish the quiz.** The projector plays the **winners reveal**: 3rd, then 2nd, a pause, then the winner with confetti. **See full leaderboard** closes it; **Replay winners** plays it again.
7. **Pictures to share:**
   - **Players** tap **Share my result** on their phone to get a portrait image with the event name, their avatar and name, their rank out of N, their points and correct answers. The top 3 get gold, silver or bronze rings, light rays, confetti and a medal ribbon.
   - **The host** taps **Share top 3** on the final leaderboard, or later from **Recent finished sessions**, to get a podium picture of the winners.
   - Images are created on the device and work offline. **Save image** always works (on phones you can also press and hold the picture). **Share** appears where the browser allows it; phones only allow direct sharing on secure (`https`) pages, so over local Wi-Fi most people will save first.
8. **Export results.** Download the CSV of all players' ranks and points from the final screen or from **Recent finished sessions**.

Phones only ever see their **own** rank and points ("#7 of 26 players"); the full ranking stays on the projector. The host moves through the quiz manually; timers never jump to the next question by themselves. One session runs at a time, and it uses a frozen copy of the quiz, so editing the quiz during an event doesn't affect it.

### Reconnecting

Players resume by opening the same address in the **same browser**. Their player is saved in that browser, so a refresh, a dropped connection or a server restart puts them back on the current question. Missed questions score 0. New players can only join while the lobby is open.

## 6. Scoring, Fastest and ties

A correct answer received before the deadline earns:

```text
points = round(basePoints × (0.5 + 0.5 × max(0, 1 − responseTime / answerTime)))
```

The clock starts when the options appear and is measured on the server. For a 1,000-point, 20-second question: answering at 0 s earns 1,000, at 10 s 750, and at exactly 20 s 500. Wrong, missing, late and poll answers earn 0. Wi-Fi congestion can affect timing.

**Ranking:** highest score, then most correct answers, then lowest total answer time. Exact ties share a rank.

**Fastest award:** the player with the lowest average answer time across **all** scored questions. A wrong or missing answer counts as the full answer time, so skipping questions can never help, and you need at least one correct answer to qualify. Ties share the award. It doesn't change points or ranks.

## 7. Fair play and security

MuziQuiz was tested against cheating attempts. Phones cannot:

- send their own time, points or score
- see the answer options during reading time, or the correct answer before the reveal (in their own data, the projector feed or the API)
- learn from their receipt whether an answer was right before the reveal
- answer twice, change an answer, answer after the deadline, or answer a question that isn't live
- take over another player with a guessed token, use host controls without the password, or send requests from another website
- join after the quiz has started

Built-in limits:

- **Players per device:** each device (IP address) can create at most **2 players per session** (setting: `MAX_PLAYERS_PER_DEVICE`). This stops one laptop from running fake players that cover every answer. Kicked players still count, and the host laptop is exempt for testing.
- **Kicks free the room:** removing a player frees their place, so fake players can't permanently fill the room.
- **Look-alike names:** names that mix alphabets (for example a Cyrillic "М" inside "MUZI") are rejected.
- **Host password:** a minimum of 12 characters, stored only as a salted hash. Sign-in attempts are rate-limited. The first password can only be created from the host laptop itself.

**Known limits:** someone with several physical phones still gets 2 players on each; set `MAX_PLAYERS_PER_DEVICE=1` for serious competitions. The app runs on plain `http` over local Wi-Fi, so sign in to the host space on the laptop itself rather than from a phone.

**Reserved creator name:** "MUZI" (and look-alikes such as "MUZl" or "MUZ1") is reserved. Typing it gives a random Player name instead. The real creator identity (gold skull avatar and Creator tag) is claimed by typing a private join code as the nickname. The code is built into the app as a SHA-256 hash only and is not shown anywhere in the interface; `RESERVED_JOIN_CODE_HASH` in `.env` can override it. It gives no host rights or points advantage.

## 8. Settings

Everything works without settings. To change something, create a `.env` file: for the source version, copy `.env.example` to `.env` in the project folder; for the desktop app, use `%APPDATA%\MuziQuiz\.env`. Restart afterwards.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Port for the website and live connections. The desktop app tries the next ports if this one is busy. |
| `DATA_DIR` | `./data` | Database folder (source version only; the desktop app uses `%APPDATA%\MuziQuiz\data`). |
| `MAX_PLAYERS_PER_DEVICE` | 2 | Players one device may create per session (1–200). |
| `RESERVED_JOIN_CODE_HASH` | built-in code | Optional override: SHA-256 hash of a different private creator code. |

Never publish `.env`, the database or backups.

## 9. Event-day checklist

1. Install the desktop app (or install and build the source version), create the host password and prepare your quizzes **before** event day.
2. Connect the laptop and phones to the event Wi-Fi. Internet can be unplugged.
3. Start MuziQuiz (the desktop shortcut or `start-muziquiz.cmd`).
4. Check that the session uses the right Wi-Fi adapter and that the firewall allows Private networks.
5. Run a test lobby with at least three real phones: join, answer, reveal, leaderboard and a reconnect.
6. Keep the laptop plugged in and stop it from sleeping.

## 10. History, backups and updates

**Recent finished sessions** in the library keep every finished event, even after a restart or after deleting the quiz. From there you can view the final standings, download the CSV and make the **Top 3** picture.

**Reset finished-session data** clears all finished events (players, answers and results) after making a backup in `data/backups`. Quizzes, the host password and any live session are kept. Export what you need first.

**Database location:**
- Source version: `data/localmenti.sqlite`
- Desktop app: `%APPDATA%\MuziQuiz\data\localmenti.sqlite`

The internal name "localmenti" is kept for compatibility.

**Backups:** stop MuziQuiz, then copy the **whole data folder**, including any `-wal`/`-shm` files. Don't copy the database while the app is running. To restore, stop MuziQuiz and put the backed-up folder back. Database upgrades run automatically when MuziQuiz starts.

## 11. Troubleshooting

| Problem | What to check |
| --- | --- |
| Phones can't connect | Same Wi-Fi, correct address and port, MuziQuiz running, firewall allows Private networks, no client isolation, VPN or captive portal. `localhost` on a phone means the phone itself. |
| QR code opens the wrong address | Choose the adapter players are actually on when starting the session. |
| "This device already joined 2 times" | The per-device limit. Players should resume in the browser they first joined with, or the host can raise `MAX_PLAYERS_PER_DEVICE`. |
| Forgotten host password | Desktop app: **MuziQuiz → Reset host password…**. Source version: stop the server, run `npm run setup:host`, then start again. |
| Host space keeps asking to sign in | Open the host space at the same address as the session, and allow cookies. Host sign-ins last 12 hours. |
| Port already in use | Close the other MuziQuiz window or program. `start-muziquiz.cmd` and the desktop app handle this automatically. |
| Import fails | Read the error message: it must be version 2, have valid option IDs, a quiz-wide time of 5–120 seconds, and be under 512 KiB. |
| Leaderboard doesn't animate again | A reveal you've already seen doesn't replay after a refresh. Use **Replay reveal**. |
| Private join code rejected | Check the code's spelling, and that no `RESERVED_JOIN_CODE_HASH` in `.env` overrides the built-in one. After many tries, wait 15 minutes (5 attempts per device). |
| Player lost their place | They must use the same browser and the same address; clearing browser data loses the saved player. |

## 12. Development

TypeScript npm workspaces:

| Folder | Contents |
| --- | --- |
| `client/` | Vite + React screens (host, projector, phones) |
| `server/` | Fastify + Socket.IO + better-sqlite3 |
| `shared/` | Zod schemas and types shared by both |
| `desktop/` | Electron wrapper and Windows installer |
| `scripts/` | Smoke, load and offline-asset checks |

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run audit:offline
npm run smoke                       # with the server running
node scripts/lan-smoke.mjs http://<laptop-ip>:3000
npm run test:load                   # 50, 100 and 200 simulated players
```

Pages: `/join`, `/s/:pin`, `/host`, `/host/login`, `/host/quizzes/:id`, `/present/:pin` and `/health`.

### Building the desktop installer

```powershell
npm run desktop
```

This builds the project, bundles the server into the desktop app, and creates **`desktop/release/MuziQuiz-Setup-<version>.exe`**. It needs internet the first time, to download Electron.

The installer is about 130 MB, which is over GitHub's file-size limit, so **don't commit it**. Upload it as a **GitHub Release** asset instead; `desktop/app/` and `desktop/release/` are already in `.gitignore`. To change the version, edit `version` in `desktop/package.json`.

## License

No license has been chosen yet. Add a `LICENSE` file before publishing an open-source release; dependency licenses apply separately. The design and assets are original and don't use any other quiz product's branding.

---

Made by [**MUZI**](https://www.linkedin.com/in/m-muzammal-muzi5622/)
