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

function App() {
  const [mode, setMode] = React.useState<"pr" | "playground">("pr");
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
        <div className="brand">
          <div className="mark"><GitPullRequest size={22} /></div>
          <div>
            <h1>ReviewPilot</h1>
            <p>Multi-agent PR review</p>
          </div>
        </div>

        <section className="panel">
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
        {review ? (
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
            <h2>Run code through ReviewPilot</h2>
            <p>Review a public GitHub pull request or use Playground mode for a fast pasted-code demo.</p>
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
  high: "#ff5a5f",
  medium: "#ffb020",
  low: "#3ed598",
};

const riskGaugeSweep: Record<string, number> = {
  high: 300,
  medium: 200,
  low: 100,
};

function RiskGauge({ level }: { level: string }) {
  const color = riskGaugeColors[level] ?? "#647184";
  const sweep = riskGaugeSweep[level] ?? 60;
  return (
    <div className="risk-gauge">
      <div
        className="risk-gauge-ring"
        style={{ background: `conic-gradient(${color} 0deg ${sweep}deg, #1f2c40 ${sweep}deg 360deg)` }}
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
