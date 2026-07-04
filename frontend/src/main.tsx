import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, CheckCircle2, Clock, Gauge, GitPullRequest, ShieldCheck, TestTube2, Waypoints, Zap } from "lucide-react";
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

const agents = [
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "performance", label: "Performance", icon: Zap },
  { id: "architecture", label: "Architecture", icon: Waypoints },
  { id: "testing", label: "Testing", icon: TestTube2 },
];

function App() {
  const [prUrl, setPrUrl] = React.useState("");
  const [selectedAgents, setSelectedAgents] = React.useState(agents.map((agent) => agent.id));
  const [review, setReview] = React.useState<ReviewResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function runReview() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:8000/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pr_url: prUrl, agents: selectedAgents }),
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
          <label htmlFor="pr-url">GitHub pull request</label>
          <input
            id="pr-url"
            value={prUrl}
            onChange={(event) => setPrUrl(event.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
          />
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
          <button className="primary" onClick={runReview} disabled={loading || !prUrl || selectedAgents.length === 0}>
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
              <a href={review.pr.html_url} target="_blank" rel="noreferrer">Open PR</a>
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
            <h2>Run a pull request through ReviewPilot</h2>
            <p>Start with a public GitHub PR URL. Add a token in the backend `.env` when reviewing private repos or higher-volume API usage.</p>
          </section>
        )}
      </section>
    </main>
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

createRoot(document.getElementById("root")!).render(<App />);
