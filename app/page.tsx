// Placeholder shell for Day 1. The live dashboard (drift feed, belief timeline,
// reaffirm signal, brain card) lands on Day 3.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <div className="rounded-card border border-border bg-surface p-8">
        <p className="font-mono text-sm text-accent">trace · localhost:7070</p>
        <h1 className="mt-3 text-3xl font-semibold">
          A contradiction-free memory for your coding agent.
        </h1>
        <p className="mt-4 text-muted">
          Trace sits in front of Supermemory Local. Every decision your agent records is
          checked against everything already known. When a new decision reverses a prior
          one, Trace resolves it to a single current truth and keeps your{" "}
          <span className="font-mono">CLAUDE.md</span> clean. All of it on your machine.
        </p>
        <p className="mt-6 font-mono text-xs text-muted">
          Foundation is up. Detection engine and dashboard are on the way.
        </p>
      </div>
    </main>
  );
}
