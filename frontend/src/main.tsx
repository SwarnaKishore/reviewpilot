import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Gauge,
  GitPullRequest,
  ShieldCheck,
  Target,
  TestTube2,
  Waypoints,
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
  final_findings: Finding[];
  latency_ms: number;
  estimated_cost_usd: number;
  agent_runs: Array<{ agent: string; model: string; latency_ms: number; findings: Finding[] }>;
};

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

const agents = [
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "performance", label: "Performance", icon: Zap },
  { id: "architecture", label: "Architecture", icon: Waypoints },
  { id: "testing", label: "Testing", icon: TestTube2 },
];

function App() {
  const [mode, setMode] = React.useState<"pr" | "playground">("pr");
  const [prUrl, setPrUrl] = React.useState("");
  const [language, setLanguage] = React.useState("python");
  const [filename, setFilename] = React.useState("example.py");
  const [code, setCode] = React.useState("");
  const [selectedAgents, setSelectedAgents] = React.useState(agents.map((agent) => agent.id));
  const [review, setReview] = React.useState<ReviewResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function runReview() {
    setLoading(true);
    setError("");
    try {
      const endpoint = mode === "pr" ? "/api/reviews" : "/api/playground/reviews";
      const payload =
        mode === "pr"
          ? { pr_url: prUrl, agents: selectedAgents }
          : { language, filename, code, agents: selectedAgents };
      const response = await fetch(`http://127.0.0.1:8000${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.detail || "Review failed");
      }
      setReview(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }

  async function markFinding(findingId: string, status: string) {
    const response = await fetch(`http://127.0.0.1:8000/api/findings/${findingId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (response.ok) {
      setReview(await response.json());
    }
  }

  return (
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
                  <input id="language" value={language} onChange={(event) => setLanguage(event.target.value)} />
                </div>
                <div>
                  <label htmlFor="filename">Filename</label>
                  <input id="filename" value={filename} onChange={(event) => setFilename(event.target.value)} />
                </div>
              </div>
              <label htmlFor="code">Code</label>
              <textarea
                id="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={"def divide(a, b):\n    return a / b"}
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
                  onClick={() =>
                    setSelectedAgents((current) =>
                      current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id],
                    )
                  }
                  type="button"
                  title={`${agent.label} agent`}
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
            disabled={loading || selectedAgents.length === 0 || (mode === "pr" ? !prUrl : !code.trim())}
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
      </aside>

      <section className="workspace">
        {review ? (
          <>
            <header className="review-header">
              <div>
                <p className="eyebrow">{review.pr.owner}/{review.pr.repo} #{review.pr.number}</p>
                <h2>{review.pr.title}</h2>
                <p>{review.summary}</p>
              </div>
              {review.pr.html_url !== "#" ? <a href={review.pr.html_url} target="_blank" rel="noreferrer">Open PR</a> : null}
            </header>

            <div className="run-strip">
              {review.agent_runs.map((run) => (
                <div className="run" key={run.agent}>
                  <span>{run.agent}</span>
                  <strong>{run.findings.length}</strong>
                  <small>{run.model} · {run.latency_ms}ms</small>
                </div>
              ))}
            </div>

            <EvaluationDashboard review={review} />

            <section className="findings">
              {review.final_findings.map((finding) => (
                <article className="finding" key={finding.id}>
                  <div className="finding-top">
                    <span className={`severity ${finding.severity}`}>{finding.severity}</span>
                    <span>{finding.agent}</span>
                    <code>{finding.file}{finding.line ? `:${finding.line}` : ""}</code>
                  </div>
                  <h3>{finding.title}</h3>
                  <p>{finding.evidence}</p>
                  <p className="recommendation">{finding.recommendation}</p>
                  <div className="feedback">
                    {["accepted", "rejected", "ignored"].map((status) => (
                      <button
                        className={finding.status === status ? "selected" : ""}
                        key={status}
                        onClick={() => markFinding(finding.id, status)}
                        type="button"
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
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
  );
}

function EvaluationDashboard({ review }: { review: ReviewResult }) {
  const summary = React.useMemo(() => computeEvaluation(review), [review]);

  return (
    <section className="evaluation">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Evaluation</p>
          <h3>Review quality dashboard</h3>
        </div>
        <span>{summary.reviewed} of {summary.total} findings scored</span>
      </div>

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

createRoot(document.getElementById("root")!).render(<App />);
