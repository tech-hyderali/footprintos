import { useState } from "react";

const GH = "https://api.github.com";
const DAY = 864e5;
const SKILLS = ["python","javascript","typescript","java","react","node","sql","docker","kubernetes","aws","cybersecurity","security","machine learning","devops","cloud","c++","django","flask","rust"];
const SECRET_RX = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /ghp_[A-Za-z0-9]{30,}/],
  ["API secret key", /sk-[A-Za-z0-9_-]{20,}/],
  ["Credential assignment", /(api[_-]?key|secret|password|token)\s*[=:]\s*['"]?[A-Za-z0-9_\/+=-]{12,}/i],
];
const RISKY = /(^|\/)(\.env(\.[\w.]+)?|id_rsa|[^/]*\.pem|credentials\.json|[^/]*\.p12)$/i;

const gh = async (p) => {
  const r = await fetch(GH + p);
  if (!r.ok) throw new Error(r.status === 403 ? "GitHub rate limit reached (60 requests/hour). Try again later." : `GitHub error ${r.status}`);
  return r.json();
};
const txt = async (u) => { try { const r = await fetch(u); return r.ok ? await r.text() : null; } catch { return null; } };
const F = (agent, title, detail, evidence, confidence, severity, action, when) => ({ agent, title, detail, evidence, confidence, severity, action, when });
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/* ---------- specialist agents ---------- */
function identityAgent(f, user, own, recent) {
  const out = [];
  const li = f.linkedinText.toLowerCase();
  const evidence = own.map((r) => [r.language, ...(r.topics || []), r.name, r.description || ""].join(" ")).join(" ").toLowerCase();
  const claimed = SKILLS.filter((s) => new RegExp("(^|[^a-z+])" + s.replace("+", "\\+") + "([^a-z]|$)").test(li));
  const missing = claimed.filter((s) => !evidence.includes(s));
  if (!li.trim()) {
    out.push(F("Identity", "LinkedIn text not provided", "Skills claimed on LinkedIn could not be compared with GitHub.", ["No LinkedIn text pasted"], "LOW", "low", "Paste your LinkedIn headline, About and skills to enable the consistency check", "week"));
  } else if (missing.length) {
    out.push(F("Identity", "LinkedIn skills lack public evidence", "Your public evidence currently provides limited support for some skills stated on your profile.", [`LinkedIn claims: ${claimed.join(", ")}`, `No matching repo language, topic or description for: ${missing.join(", ")}`, `${own.length} original repos, ${recent} active in the last 12 months`], missing.length > 2 ? "HIGH" : "MEDIUM", missing.length > 2 ? "high" : "medium", `Build or document one project that demonstrates ${missing[0]}, then reflect it in your README and LinkedIn`, "week"));
  } else if (claimed.length) {
    out.push(F("Identity", "LinkedIn skills match GitHub", "Skills you claim appear in your public repositories.", [`Matched: ${claimed.join(", ")}`], "HIGH", "info", "", "month"));
  }
  if (!user.bio) out.push(F("Identity", "GitHub bio is empty", "Visitors cannot tell who you are or what you are aiming for.", ["Profile bio: (empty)"], "HIGH", "medium", "Write a one-line GitHub bio with your role and target", "today"));
  const reused = [f.linkedinUrl, f.portfolio].some((x) => x.toLowerCase().includes(user.login.toLowerCase()));
  if (!reused) out.push(F("Identity", "Username not reused across platforms", "A consistent handle makes you easier to find.", [`GitHub: ${user.login}`, "Not found in the LinkedIn or portfolio URL you gave"], "MEDIUM", "low", "Align your handles or link all profiles to each other", "week"));
  if (recent < 2) out.push(F("Identity", "Little recent public activity", "Few repositories show activity in the last year.", [`${recent} repos pushed in the last 12 months`], "MEDIUM", "medium", "Push a small, documented project this month", "month"));
  return { out, missing };
}

async function portfolioAgent(f, user, scans, own) {
  const out = [];
  const site = f.portfolio ? await txt(/^https?:/.test(f.portfolio) ? f.portfolio : "https://" + f.portfolio) : null;
  if (!f.portfolio) out.push(F("Portfolio", "No portfolio site provided", "A personal site gives recruiters one place to see your work.", ["Portfolio field is empty"], "HIGH", "medium", "Publish a simple portfolio with 2-3 project case studies", "month"));
  else if (!site) out.push(F("Portfolio", "Portfolio could not be read from the browser", "The site may block cross-origin reads or be offline. Check it manually.", [`Fetch failed for ${f.portfolio}`], "LOW", "low", "Confirm the site loads and lists your projects", "week"));
  else if (!/project/i.test(site)) out.push(F("Portfolio", "Portfolio page does not mention projects", "Recruiters look for project evidence first.", [`${f.portfolio} loaded, no 'project' text found`], "MEDIUM", "medium", "Add a projects section with links to repos", "week"));
  const weak = scans.filter((s) => s.readme.length < 300).map((s) => s.r.name);
  if (weak.length) out.push(F("Portfolio", "Thin or missing READMEs", "Repos without documentation are hard to evaluate.", [`Short or no README: ${weak.join(", ")}`], "HIGH", weak.length > 2 ? "high" : "medium", `Add install, usage and screenshots to ${weak[0]}`, "week"));
  if (!user.blog && !f.portfolio) out.push(F("Portfolio", "No website on GitHub profile", "Profile has no link to a portfolio.", ["Profile blog: (empty)"], "MEDIUM", "low", "Add your portfolio URL to your GitHub profile", "today"));
  return { out, siteOk: !!site };
}

function securityAgent(f, user, scans) {
  const out = [];
  for (const s of scans) {
    s.risky.forEach((p, i) => {
      const hit = SECRET_RX.find(([, rx]) => rx.test(s.bodies[i] || ""));
      out.push(F("Security", hit ? `Credential-like string in ${s.r.name}` : `Sensitive file committed in ${s.r.name}`, hit ? "A value matching a secret pattern is publicly readable. Rotate it first, then remove it." : "Files like this often hold secrets and should not be public.", [`${s.r.name}/${p}`, hit ? `Pattern: ${hit[0]} (value redacted)` : "No secret pattern matched in the file"], hit ? "HIGH" : "MEDIUM", hit ? "high" : "medium", hit ? `Rotate the credential in ${s.r.name}, remove the file and clean git history` : `Remove ${p} from ${s.r.name} and add it to .gitignore`, "today"));
    });
    const hit = SECRET_RX.find(([, rx]) => rx.test(s.readme));
    if (hit) out.push(F("Security", `Credential-like string in ${s.r.name} README`, "Documentation contains something that looks like a secret.", [`${s.r.name}/README.md`, `Pattern: ${hit[0]} (value redacted)`], "MEDIUM", "high", "Replace with a placeholder and rotate if real", "today"));
  }
  if (user.email) out.push(F("Security", "Personal email is public on GitHub", "Public emails attract spam and phishing.", [`Profile email: ${user.email}`], "HIGH", "low", "Use a dedicated professional email or GitHub's no-reply address", "week"));
  if (/\+?\d[\d\s-]{8,}\d/.test(f.linkedinText + " " + (user.bio || ""))) out.push(F("Security", "Phone number may be public", "A phone-like number appears in your profile text.", ["Number pattern found in LinkedIn text or GitHub bio"], "MEDIUM", "medium", "Remove phone numbers from public profile text", "today"));
  return out;
}

/* ---------- critic, scoring, planner ---------- */
const critic = (fs) => fs.filter((x) => x.evidence.length).map((x) => (x.severity === "high" && x.confidence === "LOW" ? { ...x, severity: "medium" } : x));

function scoreAll(user, own, scans, fs, siteOk, missing, recent) {
  const n = own.length || 1, pen = { high: 30, medium: 12, low: 4, info: 0 };
  const goodReadme = scans.filter((s) => s.readme.length > 300).length / (scans.length || 1);
  const langs = new Set(own.map((r) => r.language).filter(Boolean)).size;
  const topics = own.filter((r) => r.topics?.length).length / n;
  return {
    "Professional Presence": clamp(40 * goodReadme + 25 * !!user.bio + 20 * siteOk + 15 * (own.filter((r) => r.description).length / n)),
    "Technical Evidence": clamp(Math.min(40, own.length * 8) + Math.min(30, langs * 10) + Math.min(30, recent * 10)),
    Consistency: clamp(100 - 20 * missing.length - (recent === 0 ? 20 : 0)),
    "Security Exposure": clamp(100 - fs.filter((x) => x.agent === "Security").reduce((a, x) => a + pen[x.severity], 0)),
    Discoverability: clamp(25 * !!user.bio + 25 * !!(user.blog || siteOk) + 20 * topics + 15 * !fs.some((x) => x.title.startsWith("Username")) + Math.min(15, user.followers * 3)),
  };
}

async function audit(f, log) {
  const login = f.github.replace(/^.*github\.com\//, "").replace(/[/?#].*$/, "").trim();
  log("Orchestrator: plan = GitHub data, then Identity, Portfolio and Security agents, then Critic and Planner");
  const user = await gh(`/users/${login}`);
  const repos = await gh(`/users/${login}/repos?per_page=100&sort=pushed`);
  const own = repos.filter((r) => !r.fork);
  log(`Collected ${repos.length} public repos (${own.length} original)`);
  const scans = await Promise.all(own.slice(0, 6).map(async (r) => {
    const t = await gh(`/repos/${login}/${r.name}/git/trees/${r.default_branch}?recursive=1`).catch(() => null);
    const risky = (t?.tree || []).map((x) => x.path).filter((p) => RISKY.test(p)).slice(0, 2);
    const base = `https://raw.githubusercontent.com/${login}/${r.name}/${r.default_branch}/`;
    return { r, risky, readme: (await txt(base + "README.md")) || "", bodies: await Promise.all(risky.map((p) => txt(base + p))) };
  }));
  log("Security agent: scanned file names and README text for exposure (values are never displayed)");
  const recent = own.filter((r) => Date.now() - new Date(r.pushed_at) < 365 * DAY).length;
  const id = identityAgent(f, user, own, recent);
  const pf = await portfolioAgent(f, user, scans, own);
  const findings = critic([...id.out, ...pf.out, ...securityAgent(f, user, scans)]);
  log(`Critic: kept ${findings.length} findings that have evidence`);
  const scores = scoreAll(user, own, scans, findings, pf.siteOk, id.missing, recent);
  const total = clamp(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { user, own, scores, total, findings, top: findings.find((x) => x.severity !== "info") };
}

async function draftAll(f, res, key) {
  const facts = { name: f.name, role: f.role, target: f.target, bio: res.user.bio, repos: res.own.slice(0, 6).map((r) => ({ name: r.name, language: r.language, description: r.description })), findings: res.findings.map((x) => x.title) };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1800, messages: [{ role: "user", content: `Draft profile improvements for a student targeting "${f.target}". Use ONLY these facts, never invent experience or skills. Reply with JSON only, keys: github_bio, github_profile_readme, linkedin_about, project_descriptions, resume_bullets (all strings).\n${JSON.stringify(facts)}` }] }),
  });
  if (!r.ok) throw new Error(`Claude API error ${r.status}`);
  const d = await r.json();
  return JSON.parse(d.content.map((c) => c.text || "").join("").replace(/```json|```/g, "").trim());
}

/* ---------- UI ---------- */
const C = { bg: "#0b0f14", card: "#121821", line: "#1f2a37", tx: "#e6edf3", mute: "#8b9bb0", ac: "#22d3ee", high: "#f87171", medium: "#fbbf24", low: "#60a5fa", info: "#34d399" };
const S = {
  page: { minHeight: "100vh", background: C.bg, color: C.tx, fontFamily: "'DM Sans',sans-serif", padding: "32px 16px" },
  wrap: { maxWidth: 900, margin: "0 auto" },
  card: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginTop: 16 },
  input: { width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, color: C.tx, padding: "10px 12px", fontFamily: "inherit", fontSize: 14 },
  btn: { background: C.ac, color: "#04222a", border: 0, borderRadius: 8, padding: "11px 20px", fontWeight: 700, fontSize: 15, cursor: "pointer" },
  ghost: { background: "transparent", color: C.ac, border: `1px solid ${C.ac}`, borderRadius: 8, padding: "7px 14px", fontWeight: 600, cursor: "pointer" },
  mono: { fontFamily: "'JetBrains Mono',monospace", fontSize: 12 },
};

const Ring = ({ v }) => {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Score ${v} out of 100`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke={C.line} strokeWidth="10" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={C.ac} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform="rotate(-90 70 70)" style={{ transition: "stroke-dashoffset 1s" }} />
      <text x="70" y="76" textAnchor="middle" fill={C.tx} fontSize="34" fontWeight="700">{v}</text>
      <text x="70" y="96" textAnchor="middle" fill={C.mute} fontSize="11">out of 100</text>
    </svg>
  );
};

const Bar = ({ k, v }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{k}</span><span style={S.mono}>{v}</span></div>
    <div style={{ background: C.line, borderRadius: 4, height: 8, marginTop: 4 }}><div style={{ width: `${v}%`, height: 8, borderRadius: 4, background: v > 70 ? C.info : v > 45 ? C.medium : C.high, transition: "width 1s" }} /></div>
  </div>
);

const LABELS = { github_bio: "GitHub bio", github_profile_readme: "GitHub profile README", linkedin_about: "LinkedIn About", project_descriptions: "Project descriptions", resume_bullets: "Resume bullets" };

export default function App() {
  const [f, setF] = useState({ name: "", role: "Computer Science Student", target: "Software engineering internships", github: "", linkedinUrl: "", portfolio: "", linkedinText: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [trace, setTrace] = useState([]);
  const [res, setRes] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [ok, setOk] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const run = async () => {
    setBusy(true); setErr(""); setRes(null); setDrafts(null); setOk({}); setTrace([]);
    try { setRes(await audit(f, (m) => setTrace((t) => [...t, m]))); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const fix = async () => {
    const key = import.meta.env.VITE_ANTHROPIC_KEY;
    if (!key) return setErr("Add VITE_ANTHROPIC_KEY to a .env file to generate drafts (see .env.example).");
    setBusy(true); setErr("");
    try { setDrafts(await draftAll(f, res, key)); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const when = (w) => res.findings.filter((x) => x.when === w && x.action);

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={{ margin: 0, fontSize: 32 }}>FootprintOS</h1>
        <p style={{ color: C.mute, marginTop: 6 }}>See how you appear online, what needs fixing, and what to do first.</p>

        <div style={S.card}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
            {[["name", "Name"], ["role", "Role"], ["target", "Target"], ["github", "GitHub username or URL"], ["linkedinUrl", "LinkedIn URL"], ["portfolio", "Portfolio URL"]].map(([k, l]) => (
              <label key={k} style={{ fontSize: 13, color: C.mute }}>{l}<input style={{ ...S.input, marginTop: 4 }} value={f[k]} onChange={set(k)} /></label>
            ))}
          </div>
          <label style={{ display: "block", fontSize: 13, color: C.mute, marginTop: 12 }}>LinkedIn headline, About and skills (paste text)
            <textarea style={{ ...S.input, marginTop: 4, minHeight: 80 }} value={f.linkedinText} onChange={set("linkedinText")} />
          </label>
          <button style={{ ...S.btn, marginTop: 14, opacity: busy || !f.github ? 0.6 : 1 }} disabled={busy || !f.github} onClick={run}>{busy && !res ? "Auditing..." : "Audit my digital footprint"}</button>
          <p style={{ ...S.mono, color: C.mute, marginBottom: 0 }}>Only public data is read. Nothing is changed on any account.</p>
        </div>

        {err && <div style={{ ...S.card, borderColor: C.high, color: C.high }}>{err}</div>}
        {trace.length > 0 && <div style={{ ...S.card, ...S.mono, color: C.mute }}>{trace.map((t, i) => <div key={i}>{t}</div>)}</div>}

        {res && (<>
          <div style={{ ...S.card, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <Ring v={res.total} />
            <div style={{ flex: 1, minWidth: 240 }}>{Object.entries(res.scores).map(([k, v]) => <Bar key={k} k={k} v={v} />)}</div>
          </div>

          <div style={S.card}>
            <h2 style={{ marginTop: 0 }}>Summary</h2>
            <p style={{ margin: 0 }}>{res.top ? <>Most important issue: <b>{res.top.title}</b>. {res.top.detail}</> : "No significant issues found."}</p>
            {res.findings.some((x) => x.agent === "Security" && x.severity === "high") && <p style={{ color: C.high }}>Security concern: a credential-like string was found. Review it first.</p>}
          </div>

          <h2 style={{ marginBottom: 0 }}>Evidence</h2>
          {res.findings.map((x, i) => (
            <div key={i} style={{ ...S.card, borderLeft: `4px solid ${C[x.severity]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{x.title}</b><span style={{ ...S.mono, color: C.mute }}>{x.agent} agent, confidence {x.confidence}</span></div>
              <p style={{ color: C.mute, margin: "6px 0" }}>{x.detail}</p>
              <ul style={{ ...S.mono, margin: 0, paddingLeft: 18 }}>{x.evidence.map((e, j) => <li key={j}>{e}</li>)}</ul>
            </div>
          ))}

          <h2 style={{ marginBottom: 0 }}>Action plan</h2>
          <div style={{ ...S.card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
            {[["today", "Today"], ["week", "This week"], ["month", "This month"]].map(([w, l]) => (
              <div key={w}><b>{l}</b>{when(w).length ? when(w).map((x, i) => <div key={i} style={{ marginTop: 8, fontSize: 14 }}>☐ {x.action}</div>) : <div style={{ color: C.mute, fontSize: 14, marginTop: 8 }}>Nothing needed</div>}</div>
            ))}
          </div>

          <div style={S.card}>
            <h2 style={{ marginTop: 0 }}>Fix my footprint</h2>
            {!drafts ? (<>
              <p style={{ color: C.mute }}>I can prepare a GitHub bio and README, a LinkedIn About section, project descriptions and resume bullets. I cannot publish anything: you review, approve and copy each one yourself.</p>
              <button style={S.btn} disabled={busy} onClick={fix}>{busy ? "Drafting..." : "Prepare drafts"}</button>
            </>) : Object.entries(LABELS).map(([k, l]) => drafts[k] && (
              <div key={k} style={{ marginTop: 14 }}>
                <b>{l}</b>
                <pre style={{ ...S.mono, whiteSpace: "pre-wrap", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: 12 }}>{typeof drafts[k] === "string" ? drafts[k] : JSON.stringify(drafts[k], null, 2)}</pre>
                {ok[k] ? <button style={S.ghost} onClick={() => navigator.clipboard.writeText(typeof drafts[k] === "string" ? drafts[k] : JSON.stringify(drafts[k], null, 2))}>Copy approved draft</button> : <button style={S.ghost} onClick={() => setOk({ ...ok, [k]: true })}>Approve</button>}
              </div>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}
