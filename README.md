# FootprintOS

**Audit how a student appears online, find what hurts them, and get a prioritized plan to fix it.**

FootprintOS takes a student's public GitHub, LinkedIn text and portfolio site, investigates them with a set of specialist modules, and produces a scored, evidence-backed report with an action plan. It can also draft improved profile content, which the user must review and approve before using.

It sits at the intersection of AI, cybersecurity and personal branding for students.

## What it does

The user enters a name, role, target (for example, software engineering internships), a GitHub username, LinkedIn URL, portfolio URL and pasted LinkedIn text, then clicks **Audit my digital footprint**.

The app returns:

- **Digital Footprint Scorecard:** an overall score out of 100 plus five category scores
- **Executive summary:** the single most important issue and any security concern
- **Evidence-backed findings:** each with a severity, a confidence level and the exact evidence behind it
- **Action plan:** tasks grouped into Today, This week and This month
- **Fix my footprint:** AI-drafted content (GitHub bio, profile README, LinkedIn About, project descriptions, resume bullets) that is only usable after explicit human approval

Findings are phrased as observations about public evidence, for example "Your public evidence currently provides limited support for some skills stated on your profile", not as judgments about the person.

## How it works

```
User input
    │
    ▼
Orchestrator (audit)
    │  collects GitHub profile, repositories, file trees, READMEs
    ├──► Identity agent    LinkedIn claims vs GitHub evidence, bio, username reuse, activity
    ├──► Portfolio agent   README depth, portfolio site reachability, project mentions
    └──► Security agent    sensitive files, secret-like strings, public email and phone
    │
    ▼
Critic     drops findings without evidence, downgrades low-confidence high severity
    │
    ▼
Scoring + Planner     five scores, findings sorted by severity, actions grouped by urgency
    │
    ▼
Report ──► "Fix my footprint" ──► Claude drafts ──► Human approval ──► Copy
```

The pipeline is deterministic and rule-based. Claude is used only for the drafting step at the end.

## Scoring

Each category is scored 0-100. The overall score is the average of the five.

| Category | How it is calculated |
|---|---|
| Professional Presence | README quality (40), GitHub bio present (25), portfolio site reachable (20), repos with descriptions (15) |
| Technical Evidence | Original repo count, up to 40 (8 each); language diversity, up to 30 (10 each); repos active in the last 12 months, up to 30 (10 each) |
| Consistency | 100, minus 20 per LinkedIn skill with no public evidence, minus 20 if no repo was active in 12 months |
| Security Exposure | 100, minus penalties per security finding (high 30, medium 12, low 4) |
| Discoverability | Bio (25), website link (25), repos with topics (20), username reused across platforms (15), followers up to 15 |

A skill counts as "supported" when its name appears in a repo's language, topics, name or description.

## Security checks

Only public information is read, and nothing is modified on any account. The Security agent checks:

- Committed files such as `.env`, `.env.*`, `id_rsa`, `*.pem`, `credentials.json` and `*.p12`
- Secret-like patterns in those files and in READMEs: AWS access keys, GitHub tokens, `sk-` style API keys, and `api_key` / `secret` / `password` / `token` assignments
- A personal email exposed on the GitHub profile
- A phone-like number in the pasted LinkedIn text or GitHub bio

Matched values are never displayed. The report shows only the file path and the pattern type. Audit only your own profiles or ones you are authorized to review.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite |
| Styling | Inline CSS, no UI libraries, dark theme |
| Data | GitHub REST API and raw.githubusercontent.com (public, no auth) |
| AI | Anthropic Claude API, drafting only |

## Getting started

Requires Node.js 18+.

```bash
git clone https://github.com/YOUR_USERNAME/footprintos.git
cd footprintos
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

### Enable "Fix my footprint" (optional)

The audit works without any key. To enable AI drafts, copy `.env.example` to `.env` and set:

```
VITE_ANTHROPIC_KEY=your_key_here
```

The key is exposed to the browser, so use it for local development only. For a deployed version, move the Claude call behind a server-side proxy.

## Project structure

```
footprintos/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
└── src/
    ├── main.jsx      # React entry point
    └── App.jsx       # agents, scoring, orchestrator, UI (single file)
```

## Limitations

- **Not a fully autonomous agent.** The steps run in a fixed order. There is no LLM-driven planning or tool selection yet.
- **Portfolio sites** often block cross-origin reads from the browser, so the Portfolio agent may report the site as unreadable (reported with low confidence). A small server-side proxy would fix this.
- **LinkedIn** is not scraped. The user pastes their headline, About and skills, because scraping is unreliable and against LinkedIn's terms.
- **GitHub rate limit:** unauthenticated requests are capped at 60 per hour. An audit uses up to 8 API calls (profile, repo list, and one file tree for each of the first 6 original repos).
- **Skill matching is keyword-based** and can miss skills that are demonstrated but named differently.
- Only the six most recently pushed original repositories are scanned in depth.

## Roadmap

- Replace the fixed pipeline with a Claude tool-use loop, where the model plans the investigation and chooses tools, keeping scoring and secret detection as deterministic tools
- LLM-based critic that checks whether the evidence supports each claim
- Optional GitHub token field to lift the rate limit
- Server-side proxy for portfolio fetching and for the Claude API
- Apply approved changes through the GitHub API, with per-change confirmation

## License

MIT