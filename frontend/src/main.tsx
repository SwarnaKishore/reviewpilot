import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  EyeOff,
  FileText,
  Gauge,
  GitPullRequest,
  ShieldCheck,
  Target,
  TestTube2,
  Waypoints,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import "./styles.css";

type Finding = {
  id: string;
  agent: string;
  file: string;
  line: number | null;
  severity: string;
  category: string;
  title: string;
  evidence: string;
  recommendation: string;
  status: string;
};

type ReviewResult = {
  id: string;
  pr: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    author: string | null;
    html_url: string;
    files: Array<{ filename: string; additions: number; deletions: number; status: string }>;
  };
  risk_level: string;
  recommendation: string;
  summary: string;
  change_summary: {
    overview: string;
    changed_areas: string[];
    behavior_changes: string[];
    review_focus: string[];
  };
  final_findings: Finding[];
  latency_ms: number;
  estimated_cost_usd: number;
  agent_runs: Array<{ agent: string; model: string; latency_ms: number; findings: Finding[] }>;
};

type ReviewSummary = {
  id: string;
  title: string;
  owner: string;
  repo: string;
  number: number;
  risk_level: string;
  recommendation: string;
  latency_ms: number;
  estimated_cost_usd: number;
  created_at: string;
};

type PendingDelete =
  | { type: "all" }
  | { type: "single"; review: ReviewSummary };

type EvaluationSummary = {
  total: number;
  accepted: number;
  rejected: number;
  ignored: number;
  reviewed: number;
  acceptedRate: number;
  falsePositiveRate: number;
  costPerAccepted: number;
  agentMetrics: Array<{
    agent: string;
    findings: number;
    accepted: number;
    rejected: number;
    ignored: number;
    acceptanceRate: number;
  }>;
};

type LanguageOption = {
  id: string;
  label: string;
  filename: string;
  sample: string;
};

const agents = [
  { id: "summary", label: "Summary", icon: FileText, locked: true },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "performance", label: "Performance", icon: Zap },
  { id: "architecture", label: "Architecture", icon: Waypoints },
  { id: "testing", label: "Testing", icon: TestTube2 },
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

const languageOptions: LanguageOption[] = [
  {
    id: "python",
    label: "Python",
    filename: "auth.py",
    sample: `def get_user_profile(request, db):
    user_id = request.json.get("user_id")
    query = f"SELECT * FROM users WHERE id = {user_id}"
    user = db.execute(query).fetchone()

    if request.json.get("include_token"):
        print("User token:", user["api_token"])

    return {
        "id": user["id"],
        "email": user["email"],
        "api_token": user["api_token"]
    }`,
  },
  {
    id: "typescript",
    label: "TypeScript",
    filename: "auth.ts",
    sample: `import express from "express";

app.get("/users/:id", async (req, res) => {
  const query = \`SELECT * FROM users WHERE id = \${req.params.id}\`;
  const user = await db.query(query);

  if (req.query.debug) {
    console.log("token", user.rows[0].apiToken);
  }

  res.json({
    id: user.rows[0].id,
    email: user.rows[0].email,
    apiToken: user.rows[0].apiToken
  });
});`,
  },
  {
    id: "javascript",
    label: "JavaScript",
    filename: "auth.js",
    sample: `app.post("/transfer", async (req, res) => {
  const accountId = req.body.accountId;
  const amount = req.body.amount;
  const sql = "UPDATE accounts SET balance = balance - " + amount + " WHERE id = " + accountId;

  console.log("session", req.headers.authorization);
  await db.query(sql);

  res.json({ ok: true });
});`,
  },
  {
    id: "java",
    label: "Java",
    filename: "UserController.java",
    sample: `public UserDto getUserProfile(HttpServletRequest request) throws SQLException {
    String userId = request.getParameter("userId");
    String sql = "SELECT * FROM users WHERE id = " + userId;
    ResultSet rs = connection.createStatement().executeQuery(sql);
    rs.next();

    System.out.println("token=" + rs.getString("api_token"));
    return new UserDto(rs.getInt("id"), rs.getString("email"), rs.getString("api_token"));
}`,
  },
  {
    id: "csharp",
    label: "C#",
    filename: "UserController.cs",
    sample: `public IActionResult GetProfile(string userId, bool debug)
{
    var sql = $"SELECT * FROM Users WHERE Id = {userId}";
    var user = _db.Users.FromSqlRaw(sql).First();

    if (debug)
    {
        Console.WriteLine($"token={user.ApiToken}");
    }

    return Ok(new { user.Id, user.Email, user.ApiToken });
}`,
  },
  {
    id: "go",
    label: "Go",
    filename: "handler.go",
    sample: `func GetProfile(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("user_id")
    query := "SELECT * FROM users WHERE id = " + userID
    row := db.QueryRow(query)

    var user User
    row.Scan(&user.ID, &user.Email, &user.APIToken)
    log.Println("token", user.APIToken)
    json.NewEncoder(w).Encode(user)
}`,
  },
  {
    id: "sql",
    label: "SQL",
    filename: "migration.sql",
    sample: `CREATE TABLE user_exports AS
SELECT id, email, password_hash, api_token
FROM users;

GRANT SELECT ON user_exports TO public;

CREATE INDEX users_email_idx ON users(email);`,
  },
  {
    id: "other",
    label: "Other",
    filename: "snippet.txt",
    sample: "",
  },
];

type Theme = "indigo" | "ocean" | "daylight";

const THEME_STORAGE_KEY = "reviewpilot-theme";

const THEMES: { id: Theme; label: string; swatch: [string, string] }[] = [
  { id: "daylight", label: "Daylight", swatch: ["#f5f6fb", "#6f5ce6"] },
  { id: "indigo", label: "Indigo", swatch: ["#0d0e1c", "#8b7cf6"] },
  { id: "ocean", label: "Ocean", swatch: ["#06131f", "#38bdf8"] },
];

function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "daylight";
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "indigo" || stored === "ocean" || stored === "daylight") {
      return stored;
    }
  } catch {
    // localStorage unavailable, fall back to default
  }
  return "daylight";
}

function ThemeSwitcher({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Color theme">
      {THEMES.map(({ id, label, swatch }) => (
        <button
          key={id}
          className={theme === id ? "theme-dot active" : "theme-dot"}
          style={{ background: `linear-gradient(135deg, ${swatch[0]} 50%, ${swatch[1]} 50%)` }}
          onClick={() => onChange(id)}
          type="button"
          role="radio"
          aria-checked={theme === id}
          title={label}
        />
      ))}
    </div>
  );
}

type View = "landing" | "choose" | "workspace";

function App() {
  const [view, setView] = React.useState<View>("landing");
  const [startMode, setStartMode] = React.useState<"pr" | "playground">("pr");
  const [theme, setTheme] = React.useState<Theme>(getStoredTheme);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore write failures (private browsing, storage disabled, etc.)
    }
  }, [theme]);

  return view === "landing" ? (
    <LandingPage onGetStarted={() => setView("choose")} theme={theme} onThemeChange={setTheme} />
  ) : view === "choose" ? (
    <ChooseMode
      onBack={() => setView("landing")}
      onSelect={(mode) => {
        setStartMode(mode);
        setView("workspace");
      }}
      theme={theme}
      onThemeChange={setTheme}
    />
  ) : (
    <ReviewWorkspace
      initialMode={startMode}
      onHome={() => setView("landing")}
      theme={theme}
      onThemeChange={setTheme}
    />
  );
}

const landingFeatures = [
  {
    icon: ShieldCheck,
    title: "Security",
    description: "Flags injection risk, secret leakage, and unsafe auth patterns as they appear in the diff.",
  },
  {
    icon: Zap,
    title: "Performance",
    description: "Catches N+1 queries, blocking calls, and other regressions before they hit production.",
  },
  {
    icon: Waypoints,
    title: "Architecture",
    description: "Reviews structure, coupling, and consistency against the rest of the codebase.",
  },
  {
    icon: TestTube2,
    title: "Testing",
    description: "Checks coverage gaps and missing edge cases for the behavior a change introduces.",
  },
];

const landingSteps = [
  {
    step: "01",
    title: "Bring your code",
    description: "Point ReviewPilot at whatever you're working on — a real change or a quick snippet.",
  },
  {
    step: "02",
    title: "Get an instant summary",
    description: "Before anything else runs, a Summary agent explains what changed and why it matters.",
  },
  {
    step: "03",
    title: "Specialists dig in",
    description: "Security, Performance, Architecture, and Testing agents inspect the change in parallel.",
  },
  {
    step: "04",
    title: "The Judge cuts the noise",
    description: "Duplicate and speculative findings are merged or dropped, and severity gets recalibrated against real evidence.",
  },
  {
    step: "05",
    title: "Review, decide, ship",
    description: "Accept, reject, or ignore each finding, then post a summary or inline comments straight back to GitHub.",
  },
];

function LandingPage({
  onGetStarted,
  theme,
  onThemeChange,
}: {
  onGetStarted: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <main className="landing">
      <div className="landing-glow" aria-hidden="true" />
      <header className="landing-nav">
        <div className="brand">
          <div className="mark"><GitPullRequest size={20} /></div>
          <div>
            <h1>ReviewPilot</h1>
          </div>
        </div>
        <div className="landing-nav-right">
          <ThemeSwitcher theme={theme} onChange={onThemeChange} />
          <a
            className="landing-nav-link"
            href="https://github.com/SwarnaKishore/reviewpilot"
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">Multi-agent code review</p>
        <h2>A full review team for your code, not just a linter</h2>
        <p className="hero-lede">
          Every review opens with a plain-English summary of what changed, then Security, Performance,
          Architecture, and Testing agents dig in parallel. A Judge agent dedupes the findings and
          recalibrates severity — so what's left is worth your time.
        </p>
        <div className="hero-actions">
          <button className="primary hero-cta" onClick={onGetStarted} type="button">
            Get Started
          </button>
          <a
            className="secondary-action hero-secondary"
            href="https://github.com/SwarnaKishore/reviewpilot"
            target="_blank"
            rel="noreferrer"
          >
            Read the docs
          </a>
        </div>
      </section>

      <section className="landing-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Agents</p>
            <h3>Four specialists, one Judge</h3>
          </div>
        </div>
        <div className="feature-grid">
          {landingFeatures.map(({ icon: Icon, title, description }) => (
            <div className="feature-card" key={title}>
              <div className="mark feature-mark"><Icon size={18} /></div>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">How it works</p>
            <h3>From diff to decision</h3>
          </div>
        </div>
        <div className="steps-grid">
          {landingSteps.map(({ step, title, description }) => (
            <div className="step-card" key={step}>
              <span className="step-number">{step}</span>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h3>Bring your code — see what the agents find.</h3>
        <button className="primary hero-cta" onClick={onGetStarted} type="button">
          Get Started
        </button>
      </section>
    </main>
  );
}

function ChooseMode({
  onBack,
  onSelect,
  theme,
  onThemeChange,
}: {
  onBack: () => void;
  onSelect: (mode: "pr" | "playground") => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <main className="choose">
      <div className="landing-glow" aria-hidden="true" />
      <div className="choose-top">
        <button className="choose-back" onClick={onBack} type="button">
          &larr; Back
        </button>
        <ThemeSwitcher theme={theme} onChange={onThemeChange} />
      </div>
      <div className="choose-heading">
        <p className="eyebrow">Get started</p>
        <h2>How do you want to review code?</h2>
        <p className="hero-lede">Both modes run the same specialist agents and Judge — pick whichever fits what you have.</p>
      </div>
      <div className="choose-grid">
        <button className="choose-card" onClick={() => onSelect("pr")} type="button">
          <div className="mark feature-mark"><GitPullRequest size={22} /></div>
          <h4>Review a Pull Request</h4>
          <p>Paste a public GitHub PR URL. ReviewPilot fetches the diff and reviews it with all four agents.</p>
          <span className="choose-card-cta">Start with a PR &rarr;</span>
        </button>
        <button className="choose-card" onClick={() => onSelect("playground")} type="button">
          <div className="mark feature-mark"><Zap size={22} /></div>
          <h4>Try the Playground</h4>
          <p>Paste any code snippet in any language. No GitHub URL or auth needed — just a fast demo review.</p>
          <span className="choose-card-cta">Open Playground &rarr;</span>
        </button>
      </div>
    </main>
  );
}

function ReviewWorkspace({
  initialMode,
  onHome,
  theme,
  onThemeChange,
}: {
  initialMode: "pr" | "playground";
  onHome: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const [mode, setMode] = React.useState<"pr" | "playground">(initialMode);
  const [page, setPage] = React.useState<"form" | "analysis">("form");
  const [prUrl, setPrUrl] = React.useState("");
  const [language, setLanguage] = React.useState(languageOptions[0].id);
  const [filename, setFilename] = React.useState(languageOptions[0].filename);
  const [code, setCode] = React.useState("");
  const [selectedAgents, setSelectedAgents] = React.useState(agents.map((agent) => agent.id));
  const [review, setReview] = React.useState<ReviewResult | null>(null);
  const [history, setHistory] = React.useState<ReviewSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [postingSummary, setPostingSummary] = React.useState(false);
  const [postingInline, setPostingInline] = React.useState(false);
  const [postMessage, setPostMessage] = React.useState("");
  const [postedCommentUrl, setPostedCommentUrl] = React.useState("");
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null);
  const [error, setError] = React.useState("");
  const [severityFilter, setSeverityFilter] = React.useState("all");
  const [evaluationOpen, setEvaluationOpen] = React.useState(true);

  React.useEffect(() => {
    loadHistory();
  }, []);

  React.useEffect(() => {
    setSeverityFilter("all");
    setEvaluationOpen(true);
  }, [review?.id]);

  React.useEffect(() => {
    if (mode === "playground" && !code.trim()) {
      const option = languageOptions.find((item) => item.id === language);
      setCode(option?.sample ?? "");
      setFilename(option?.filename ?? filename);
    }
  }, [mode]);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/reviews`);
      if (response.ok) {
        setHistory(await response.json());
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function clearHistory() {
    if (history.length === 0) {
      return;
    }
    setHistoryLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/reviews`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.detail || "Could not clear history");
      }
      setHistory([]);
      setReview(null);
      setPage("form");
      setPostMessage("");
      setPostedCommentUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteHistoryItem(item: ReviewSummary) {
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/reviews/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.detail || "Could not clear review");
      }
      setHistory((current) => current.filter((historyItem) => historyItem.id !== item.id));
      if (review?.id === item.id) {
        setReview(null);
        setPage("form");
        setPostMessage("");
        setPostedCommentUrl("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear review");
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) {
      return;
    }
    setPendingDelete(null);
    if (target.type === "all") {
      await clearHistory();
      return;
    }
    await deleteHistoryItem(target.review);
  }

  async function runReview() {
    setLoading(true);
    setError("");
    setPostMessage("");
    setPostedCommentUrl("");
    try {
      const endpoint = mode === "pr" ? "/api/reviews" : "/api/playground/reviews";
      const reviewAgents = selectedAgents.filter((agent) => agent !== "summary");
      const payload =
        mode === "pr"
          ? { pr_url: prUrl, agents: reviewAgents }
          : { language, filename, code, agents: reviewAgents };
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.detail || "Review failed");
      }
      setReview(await response.json());
      setPage("analysis");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }

  async function markFinding(findingId: string, status: string) {
    const response = await fetch(`${API_BASE_URL}/api/findings/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finding_id: findingId, status }),
    });
    if (response.ok) {
      setReview(await response.json());
      await loadHistory();
    }
  }

  async function openReview(reviewId: string) {
    setError("");
    setPostMessage("");
    setPostedCommentUrl("");
    const response = await fetch(`${API_BASE_URL}/api/reviews/${reviewId}`);
    if (!response.ok) {
      setError("Could not load saved review");
      return;
    }
    setReview(await response.json());
    setPage("analysis");
  }

  async function postSummaryToGitHub() {
    if (!review) {
      return;
    }
    setPostingSummary(true);
    setError("");
    setPostMessage("");
    setPostedCommentUrl("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/reviews/${review.id}/github/summary`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Could not post GitHub summary");
      }
      setPostMessage(payload.message);
      setPostedCommentUrl(payload.html_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post GitHub summary");
    } finally {
      setPostingSummary(false);
    }
  }

  async function postInlineCommentsToGitHub() {
    if (!review) {
      return;
    }
    setPostingInline(true);
    setError("");
    setPostMessage("");
    setPostedCommentUrl("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/reviews/${review.id}/github/inline-comments`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Could not post inline comments");
      }
      setPostMessage(payload.message);
      setPostedCommentUrl(payload.html_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post inline comments");
    } finally {
      setPostingInline(false);
    }
  }

  function changeLanguage(languageId: string) {
    const option = languageOptions.find((item) => item.id === languageId) ?? languageOptions[0];
    setLanguage(option.id);
    setFilename(option.filename);
    if (!code.trim() || language !== "other") {
      setCode(option.sample);
    }
  }

  function loadSample() {
    const option = languageOptions.find((item) => item.id === language);
    setCode(option?.sample ?? "");
    setFilename(option?.filename ?? filename);
  }

  return (
    <>
    <main className="app">
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="brand brand-home" onClick={onHome} type="button" title="Back to home">
            <div className="mark"><GitPullRequest size={22} /></div>
            <div>
              <h1>ReviewPilot</h1>
              <p>Multi-agent PR review</p>
            </div>
          </button>
          <ThemeSwitcher theme={theme} onChange={onThemeChange} />
        </div>

        <button className="primary new-review-button" onClick={() => setPage("form")} type="button" disabled={page === "form"}>
          + New Review
        </button>

        <section className="panel metrics">
          <Metric icon={Activity} label="Risk" value={review?.risk_level ?? "none"} />
          <Metric icon={CheckCircle2} label="Recommendation" value={review?.recommendation ?? "waiting"} />
          <Metric icon={Clock} label="Latency" value={review ? `${review.latency_ms}ms` : "0ms"} />
          <Metric icon={Gauge} label="Cost" value={review ? `$${review.estimated_cost_usd.toFixed(4)}` : "$0"} />
        </section>

        <section className="panel history-panel">
          <div className="history-heading">
            <h2>History</h2>
            <div className="history-actions">
              <button onClick={loadHistory} type="button" title="Refresh review history">
                refresh
              </button>
              <button onClick={() => setPendingDelete({ type: "all" })} type="button" disabled={history.length === 0 || historyLoading} title="Clear saved review history">
                clear
              </button>
            </div>
          </div>
          {historyLoading ? <p className="muted">Loading saved reviews...</p> : null}
          {!historyLoading && history.length === 0 ? <p className="muted">No saved reviews yet.</p> : null}
          <div className="history-list">
            {history.map((item) => (
              <div className={review?.id === item.id ? "history-item active" : "history-item"} key={item.id}>
                <button className="history-open" onClick={() => openReview(item.id)} type="button">
                  <span className={`history-risk ${item.risk_level}`} title={`${item.risk_level} risk`} />
                  <strong>{item.title}</strong>
                  <small>
                    {item.owner}/{item.repo} #{item.number} · {formatDate(item.created_at)}
                  </small>
                  <small>{item.recommendation} · ${item.estimated_cost_usd.toFixed(4)}</small>
                </button>
                <button
                  className="history-delete"
                  onClick={() => setPendingDelete({ type: "single", review: item })}
                  type="button"
                  title="Clear this saved review"
                  aria-label={`Clear ${item.title}`}
                >
                  <XCircle size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-topbar">
          <button className="choose-back" onClick={onHome} type="button">
            &larr; Back to Home
          </button>
          {page === "form" && review ? (
            <button className="workspace-topbar-link" onClick={() => setPage("analysis")} type="button">
              View last analysis &rarr;
            </button>
          ) : null}
        </div>
        {page === "form" ? (
          <div className="form-page">
            <div className="form-page-heading">
              <p className="eyebrow">New review</p>
              <h2>What do you want reviewed?</h2>
            </div>
            <section className="form-panel">
              <div className="tabs" role="tablist" aria-label="Review mode">
                <button className={mode === "pr" ? "active" : ""} onClick={() => setMode("pr")} type="button">
                  Pull Request
                </button>
                <button className={mode === "playground" ? "active" : ""} onClick={() => setMode("playground")} type="button">
                  Playground
                </button>
              </div>

              {mode === "pr" ? (
                <>
                  <label htmlFor="pr-url">GitHub pull request</label>
                  <input
                    id="pr-url"
                    value={prUrl}
                    onChange={(event) => setPrUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo/pull/123"
                  />
                </>
              ) : (
                <div className="playground-form">
                  <div className="field-row">
                    <div>
                      <label htmlFor="language">Language</label>
                      <select id="language" value={language} onChange={(event) => changeLanguage(event.target.value)}>
                        {languageOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="filename">Filename</label>
                      <input id="filename" value={filename} onChange={(event) => setFilename(event.target.value)} />
                    </div>
                  </div>
                  <div className="code-heading">
                    <label htmlFor="code">Code</label>
                    <button onClick={loadSample} type="button" disabled={language === "other"}>
                      Load Sample
                    </button>
                  </div>
                  <textarea
                    id="code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder={"Paste code to review"}
                    spellCheck={false}
                  />
                </div>
              )}
              <div className="agent-grid">
                {agents.map((agent) => {
                  const Icon = agent.icon;
                  const active = selectedAgents.includes(agent.id);
                  return (
                    <button
                      className={active ? "agent active" : "agent"}
                      key={agent.id}
                      disabled={agent.locked}
                      onClick={() => {
                        if (agent.locked) {
                          return;
                        }
                        setSelectedAgents((current) =>
                          current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id],
                        );
                      }}
                      type="button"
                      title={agent.locked ? "Summary agent runs before every review" : `${agent.label} agent`}
                    >
                      <Icon size={17} />
                      {agent.label}
                    </button>
                  );
                })}
              </div>
              <button
                className="primary"
                onClick={runReview}
                disabled={
                  loading ||
                  selectedAgents.length === 0 ||
                  (mode === "pr" ? !prUrl : !code.trim())
                }
              >
                {loading ? "Reviewing..." : "Run Review"}
              </button>
              {error ? <p className="error">{error}</p> : null}
            </section>
          </div>
        ) : review ? (
          <>
            <header className="review-header">
              <div className="review-header-main">
                <RiskGauge level={review.risk_level} />
                <div>
                  <p className="eyebrow">{review.pr.owner}/{review.pr.repo} #{review.pr.number}</p>
                  <h2>{review.pr.title}</h2>
                  <p>{review.summary}</p>
                </div>
              </div>
              {review.pr.html_url !== "#" ? (
                <div className="review-actions">
                  <a href={review.pr.html_url} target="_blank" rel="noreferrer">Open PR</a>
                  <button onClick={postSummaryToGitHub} disabled={postingSummary} type="button">
                    {postingSummary ? "Posting..." : "Post Summary"}
                  </button>
                  <button
                    onClick={postInlineCommentsToGitHub}
                    disabled={postingInline || review.final_findings.length === 0}
                    type="button"
                  >
                    {postingInline ? "Posting..." : "Post Inline"}
                  </button>
                </div>
              ) : null}
            </header>
            {postMessage ? (
              <div className="notice success">
                {postMessage}
                {postedCommentUrl ? <a href={postedCommentUrl} target="_blank" rel="noreferrer">View comment</a> : null}
              </div>
            ) : null}

            <ChangeSummaryPanel review={review} />

            {review.agent_runs.length > 0 ? (
              <div className="run-strip">
                {review.agent_runs.map((run) => (
                  <div className="run" key={run.agent}>
                    <span>{run.agent}</span>
                    <strong>{run.findings.length}</strong>
                    <small>{run.model} · {run.latency_ms}ms</small>
                  </div>
                ))}
              </div>
            ) : null}

            {review.agent_runs.length > 0 ? (
              <EvaluationDashboard
                review={review}
                open={evaluationOpen}
                onToggle={() => setEvaluationOpen((current) => !current)}
              />
            ) : null}

            <section className="findings">
              {review.final_findings.length === 0 ? (
                <div className="empty-findings">
                  <h3>No specialist findings</h3>
                  <p>{review.agent_runs.length === 0 ? "Summary-only mode skipped specialist agents and the Judge." : "No actionable findings were reported."}</p>
                </div>
              ) : (
                <>
                  <div className="filter-chips" role="tablist" aria-label="Filter findings by severity">
                    {["all", "high", "medium", "low"].map((level) => {
                      const count = level === "all"
                        ? review.final_findings.length
                        : review.final_findings.filter((finding) => finding.severity === level).length;
                      return (
                        <button
                          className={`chip ${level}${severityFilter === level ? " active" : ""}`}
                          key={level}
                          onClick={() => setSeverityFilter(level)}
                          type="button"
                        >
                          {level} · {count}
                        </button>
                      );
                    })}
                  </div>
                  {review.final_findings.filter(
                    (finding) => severityFilter === "all" || finding.severity === severityFilter,
                  ).length === 0 ? (
                    <div className="empty-findings">
                      <h3>No {severityFilter} findings</h3>
                      <p>Choose a different severity filter to see the rest of the findings.</p>
                    </div>
                  ) : null}
                  {review.final_findings
                    .filter((finding) => severityFilter === "all" || finding.severity === severityFilter)
                    .map((finding) => (
                      <article className={`finding ${finding.severity}`} key={finding.id}>
                        <div className="finding-top">
                          <span className={`severity ${finding.severity}`}>{finding.severity}</span>
                          <span>{finding.agent}</span>
                          <code>{finding.file}{finding.line ? `:${finding.line}` : ""}</code>
                        </div>
                        <h3>{finding.title}</h3>
                        <p>{finding.evidence}</p>
                        <p className="recommendation">{finding.recommendation}</p>
                        <div className="feedback">
                          {[
                            { status: "accepted", icon: Check, label: "Accept finding" },
                            { status: "rejected", icon: X, label: "Reject finding" },
                            { status: "ignored", icon: EyeOff, label: "Ignore finding" },
                          ].map(({ status, icon: Icon, label }) => (
                            <button
                              aria-label={label}
                              aria-pressed={finding.status === status}
                              className={finding.status === status ? "selected" : ""}
                              key={status}
                              onClick={() => markFinding(finding.id, status)}
                              title={label}
                              type="button"
                            >
                              <Icon size={15} />
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                </>
              )}
            </section>
          </>
        ) : (
          <section className="empty">
            <h2>No review loaded</h2>
            <p>Start a new review or pick a saved one from History.</p>
            <button className="primary" onClick={() => setPage("form")} type="button">
              Start a review
            </button>
          </section>
        )}
      </section>
    </main>
    {pendingDelete ? (
      <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingDelete(null)}>
        <section
          aria-labelledby="delete-dialog-title"
          aria-modal="true"
          className="confirm-dialog"
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
        >
          <h2 id="delete-dialog-title">
            {pendingDelete.type === "all" ? "Clear all history?" : "Clear this review?"}
          </h2>
          <p>
            {pendingDelete.type === "all"
              ? "This removes every saved ReviewPilot run from history."
              : `This removes "${pendingDelete.review.title}" from history.`}
          </p>
          <div className="dialog-actions">
            <button className="secondary-action" onClick={() => setPendingDelete(null)} type="button">
              Cancel
            </button>
            <button className="danger-action" onClick={confirmDelete} type="button">
              Clear
            </button>
          </div>
        </section>
      </div>
    ) : null}
    </>
  );
}

function ChangeSummaryPanel({ review }: { review: ReviewResult }) {
  const summary = review.change_summary;
  if (!summary?.overview && !summary?.changed_areas?.length && !summary?.behavior_changes?.length && !summary?.review_focus?.length) {
    return null;
  }

  return (
    <section className="change-summary">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Summary</p>
          <h3>What changed</h3>
        </div>
      </div>
      {summary.overview ? <p className="summary-overview">{summary.overview}</p> : null}
      <div className="summary-grid">
        <SummaryList title="Changed Areas" items={summary.changed_areas} />
        <SummaryList title="Behavior Changes" items={summary.behavior_changes} />
        <SummaryList title="Reviewer Focus" items={summary.review_focus} />
      </div>
    </section>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <div className="summary-list">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EvaluationDashboard({
  review,
  open,
  onToggle,
}: {
  review: ReviewResult;
  open: boolean;
  onToggle: () => void;
}) {
  const summary = React.useMemo(() => computeEvaluation(review), [review]);

  return (
    <section className="evaluation">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Evaluation</p>
          <h3>Review quality dashboard</h3>
        </div>
        <button aria-expanded={open} className="section-toggle" onClick={onToggle} type="button">
          {summary.reviewed} of {summary.total} scored
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {open ? (
        <>
          <div className="eval-grid">
            <EvalCard icon={BarChart3} label="Findings" value={`${summary.total}`} detail={`${summary.reviewed} reviewed`} />
            <EvalCard icon={CheckCircle2} label="Accepted" value={`${summary.accepted}`} detail={`${summary.acceptedRate}% accepted rate`} />
            <EvalCard icon={XCircle} label="Rejected" value={`${summary.rejected}`} detail={`${summary.falsePositiveRate}% false positive`} />
            <EvalCard icon={Target} label="Cost / accepted" value={`$${summary.costPerAccepted.toFixed(4)}`} detail={`$${review.estimated_cost_usd.toFixed(4)} total`} />
          </div>

          <div className="agent-table">
            <div className="agent-row header">
              <span>Agent</span>
              <span>Findings</span>
              <span>Accepted</span>
              <span>Rejected</span>
              <span>Ignored</span>
              <span>Acceptance</span>
            </div>
            {summary.agentMetrics.map((agent) => (
              <div className="agent-row" key={agent.agent}>
                <strong>{agent.agent}</strong>
                <span>{agent.findings}</span>
                <span>{agent.accepted}</span>
                <span>{agent.rejected}</span>
                <span>{agent.ignored}</span>
                <span>{agent.acceptanceRate}%</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function EvalCard({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return (
    <div className="eval-card">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

const riskGaugeColors: Record<string, string> = {
  high: "var(--danger)",
  medium: "var(--warning)",
  low: "var(--success)",
};

const riskGaugeSweep: Record<string, number> = {
  high: 300,
  medium: 200,
  low: 100,
};

function RiskGauge({ level }: { level: string }) {
  const color = riskGaugeColors[level] ?? "var(--text-muted)";
  const sweep = riskGaugeSweep[level] ?? 60;
  return (
    <div className="risk-gauge">
      <div
        className="risk-gauge-ring"
        style={{ background: `conic-gradient(${color} 0deg ${sweep}deg, var(--border) ${sweep}deg 360deg)` }}
      >
        <div className="risk-gauge-inner">
          <span style={{ color }}>{level}</span>
        </div>
      </div>
      <span className="risk-gauge-label">Risk</span>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function computeEvaluation(review: ReviewResult): EvaluationSummary {
  const findings = review.final_findings;
  const accepted = findings.filter((finding) => finding.status === "accepted").length;
  const rejected = findings.filter((finding) => finding.status === "rejected").length;
  const ignored = findings.filter((finding) => finding.status === "ignored").length;
  const reviewed = accepted + rejected + ignored;
  const acceptedRate = percent(accepted, accepted + rejected);
  const falsePositiveRate = percent(rejected, accepted + rejected);
  const agentMetrics = review.agent_runs.map((run) => {
    const agentFindings = findings.filter((finding) => finding.agent === run.agent);
    const agentAccepted = agentFindings.filter((finding) => finding.status === "accepted").length;
    const agentRejected = agentFindings.filter((finding) => finding.status === "rejected").length;
    const agentIgnored = agentFindings.filter((finding) => finding.status === "ignored").length;
    return {
      agent: run.agent,
      findings: agentFindings.length,
      accepted: agentAccepted,
      rejected: agentRejected,
      ignored: agentIgnored,
      acceptanceRate: percent(agentAccepted, agentAccepted + agentRejected),
    };
  });

  return {
    total: findings.length,
    accepted,
    rejected,
    ignored,
    reviewed,
    acceptedRate,
    falsePositiveRate,
    costPerAccepted: accepted > 0 ? review.estimated_cost_usd / accepted : 0,
    agentMetrics,
  };
}

function percent(numerator: number, denominator: number) {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 100);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

createRoot(document.getElementById("root")!).render(<App />);