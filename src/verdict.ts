// @bun
// Built from packages/pstack/src/verdict.ts; do not edit.

// src/roles.ts
var PANEL_SEATS = ["a", "b", "c", "d", "e"];
var WORK_ROLES = [
  {
    kind: "work",
    id: "pstack-explore",
    fallback: "@smol",
    access: "read-only",
    lane: "Read-only pstack lane that maps code and reports what it found.",
    what: "Read-only scouting: finds files, symbols and call paths and reports what it saw.",
    when: "Playbook steps that map unfamiliar code before design or edits.",
    recommended: "A fast, cheap model with a large context window."
  },
  {
    kind: "work",
    id: "pstack-build",
    fallback: "@task",
    access: "write",
    lane: "Write-capable pstack lane that implements one scoped change and runs its own checks.",
    what: "Implements a scoped change end to end: edits, runs, and fixes its own failures.",
    when: "Feature, fix and refactor steps that write code.",
    recommended: "A strong coding model with reliable tool use; a mid-tier model is usually enough."
  },
  {
    kind: "work",
    id: "pstack-mechanical",
    fallback: "@tiny",
    access: "write",
    lane: "Write-capable pstack lane for fully specified mechanical edits.",
    what: "Applies fully specified mechanical edits: renames, codemods, formatting and bulk updates.",
    when: "Steps where the change is already decided and only needs doing.",
    recommended: "The cheapest model that follows instructions exactly."
  },
  {
    kind: "work",
    id: "pstack-design",
    fallback: "@designer",
    access: "read-only",
    lane: "Read-only pstack lane that proposes or critiques a design.",
    what: "Proposes and critiques design: architecture, module boundaries, types and interfaces.",
    when: "Architect and design steps, before code is written.",
    recommended: "A model with strong design and visual judgment."
  },
  {
    kind: "work",
    id: "pstack-judge",
    fallback: "@slow",
    access: "read-only",
    lane: "Read-only pstack lane that merges panel verdicts into one decision.",
    what: "Merges the panel's verdicts into one decision and breaks ties.",
    when: "The end of a panel review (interrogate, arena, swarm, architect) and final reviews.",
    recommended: "Your strongest reasoning model."
  },
  {
    kind: "work",
    id: "pstack-security",
    fallback: "@slow",
    access: "read-only",
    lane: "Read-only pstack lane that reviews a change for security flaws.",
    what: "Reviews a change for security flaws.",
    when: "Review steps that touch authentication, input handling, secrets or dependencies.",
    recommended: "A strong reasoning model; a different vendor from your judge adds coverage."
  }
];
var seatRoleId = (seat) => `pstack-panel-${seat}`;
var PANEL_ROLES = PANEL_SEATS.map((seat) => ({
  kind: "panel",
  id: seatRoleId(seat),
  seat,
  fallback: null,
  what: `Panel seat ${seat.toUpperCase()}: an independent reviewer whose verdict is compared with the other seats.`,
  when: "Panel workflows (interrogate, arena, swarm, architect, how critics) dispatch every configured seat in parallel.",
  recommended: "A distinct model per seat, ideally from different vendors. Leave a seat unset to drop it: an unset seat is skipped, not an error."
}));
var MODEL_ROLES = [...WORK_ROLES, ...PANEL_ROLES];
var READ_ONLY_TOOLS = ["read", "grep", "glob", "lsp", "ast_grep"];
var WRITE_TOOLS = [...READ_ONLY_TOOLS, "ast_edit", "edit", "write", "bash"];
var VERDICTS = ["approve", "concerns", "reject"];
var FINDING_SEVERITIES = ["blocker", "major", "minor", "nit"];
function roleAlias(role) {
  return `@${role.id}`;
}
function workLane(role) {
  return {
    name: role.id,
    kind: "work",
    role,
    access: role.access,
    description: role.lane,
    model: [roleAlias(role), role.fallback],
    tools: role.access === "write" ? WRITE_TOOLS : READ_ONLY_TOOLS
  };
}
function seatLanes(role) {
  const seat = role.seat.toUpperCase();
  return [
    {
      name: `${role.id}-critic`,
      kind: "critic",
      role,
      access: "read-only",
      description: `Read-only pstack panel seat ${seat} critic that returns a structured verdict.`,
      model: [roleAlias(role)],
      tools: READ_ONLY_TOOLS
    },
    {
      name: `${role.id}-builder`,
      kind: "builder",
      role,
      access: "write",
      description: `Write-capable pstack panel seat ${seat} builder; dispatch it only with task isolation.`,
      model: [roleAlias(role)],
      tools: WRITE_TOOLS
    }
  ];
}
var LANE_AGENTS = [...WORK_ROLES.map(workLane), ...PANEL_ROLES.flatMap(seatLanes)];

// src/panel-rules.ts
var THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/i;
var stripThinking = (spec) => spec.replace(THINKING_SUFFIX, "");
function modelKey(spec) {
  const id = stripThinking(spec);
  return (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id).toLowerCase();
}
var SINGLE_VENDOR_WARNING = "diversity reduced: single vendor";

// src/verdict.ts
var SEVERITY_RANK = Object.fromEntries(FINDING_SEVERITIES.map((severity, index) => [severity, index]));
var VERDICT_RANK = Object.fromEntries(VERDICTS.map((verdict, index) => [verdict, index]));
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function parseFinding(value) {
  if (!isObject(value))
    return;
  const { severity, file, line, claim, evidence } = value;
  if (!FINDING_SEVERITIES.includes(severity))
    return;
  if (typeof file !== "string" || typeof line !== "number" || typeof claim !== "string" || typeof evidence !== "string")
    return;
  return { severity, file, line, claim, evidence };
}
function parseVerdict(value) {
  if (!isObject(value) || !VERDICTS.includes(value.verdict) || typeof value.summary !== "string" || !Array.isArray(value.findings))
    return;
  const findings = value.findings.map(parseFinding);
  if (findings.some((finding) => finding === undefined))
    return;
  return { verdict: value.verdict, summary: value.summary, findings };
}
var refKey = (seat, index) => `${seat}${index}`;
var normalizedFile = (file) => file.trim().replace(/^\.\//, "");
function refsOf(runs) {
  return runs.flatMap((run) => (parseVerdict(run.verdict)?.findings ?? []).map((finding, index) => ({ seat: run.seat, index, finding })));
}
var SAME_ISSUE = {
  same: {
    type: "bool",
    instructions: "Do the two findings describe the same underlying defect, so that fixing one would fix the other? Different symptoms of one root cause count. Two defects in the same file do not."
  }
};
function duplicateCandidates(runs) {
  const refs = refsOf(runs);
  const pairs = {};
  refs.forEach((a, position) => {
    for (const b of refs.slice(position + 1)) {
      if (a.seat === b.seat || normalizedFile(a.finding.file) !== normalizedFile(b.finding.file))
        continue;
      const { severity: _a, ...left } = a.finding;
      const { severity: _b, ...right } = b.finding;
      pairs[`${refKey(a.seat, a.index)}~${refKey(b.seat, b.index)}`] = { a: left, b: right };
    }
  });
  return pairs;
}
function mergeVerdicts(runs, sameIssue) {
  const refs = refsOf(runs);
  const parent = new Map(refs.map((ref) => [refKey(ref.seat, ref.index), refKey(ref.seat, ref.index)]));
  const root = (key) => {
    let current = key;
    while (parent.get(current) !== current)
      current = parent.get(current);
    return current;
  };
  for (const pair of sameIssue) {
    const [a, b] = pair.split("~");
    if (a !== undefined && b !== undefined && parent.has(a) && parent.has(b))
      parent.set(root(a), root(b));
  }
  const groups = new Map;
  for (const ref of refs) {
    const key = root(refKey(ref.seat, ref.index));
    groups.set(key, [...groups.get(key) ?? [], ref]);
  }
  const findings = [...groups.values()].map((group) => {
    const lead = group.reduce((best, ref) => SEVERITY_RANK[ref.finding.severity] < SEVERITY_RANK[best.finding.severity] ? ref : best);
    const seats2 = [...new Set(group.map((ref) => ref.seat))].sort();
    return { ...lead.finding, line: Math.min(...group.map((ref) => ref.finding.line)), raisedBy: seats2 };
  });
  findings.sort((a, b) => b.raisedBy.length - a.raisedBy.length || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const parsed = runs.map((run) => ({ run, verdict: parseVerdict(run.verdict) }));
  const seats = parsed.map(({ run, verdict }) => ({ seat: run.seat, model: run.model, ...verdict ? { verdict: verdict.verdict } : {}, findings: verdict?.findings.length ?? 0 }));
  const returned = parsed.flatMap(({ verdict }) => verdict?.verdict ?? []);
  const worst = returned.length === 0 ? "no verdict" : returned.reduce((a, b) => VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b);
  const notes = [];
  const ran = parsed.filter(({ verdict }) => verdict !== undefined).map(({ run }) => run);
  if (ran.length > 0 && new Set(ran.map((run) => run.vendor)).size === 1)
    notes.push(SINGLE_VENDOR_WARNING);
  for (const { run, verdict } of parsed) {
    const name = `Seat ${run.seat.toUpperCase()}`;
    if (!verdict)
      notes.push(`${name} returned no usable verdict: a gap, not an approval.`);
    else if (run.fellBackTo)
      notes.push(`${name} fell back from ${run.model} to ${run.fellBackTo}: its verdict came from a different model than configured.`);
  }
  const byModel = new Map;
  for (const run of ran)
    byModel.set(modelKey(run.model), [...byModel.get(modelKey(run.model)) ?? [], run.seat]);
  for (const group of byModel.values()) {
    if (group.length > 1)
      notes.push(`Seats ${group.map((seat) => seat.toUpperCase()).join(", ")} ran the same model: their agreement is one opinion, not independent evidence.`);
  }
  return { verdict: worst, seats, findings, notes };
}
function reviewerLines(merged) {
  return merged.seats.map((seat) => `Reviewer ${seat.seat.toUpperCase()}: ${seat.model}, ${seat.verdict ? `${seat.findings} finding${seat.findings === 1 ? "" : "s"}, ${seat.verdict}` : "no verdict"}`);
}
export {
  SAME_ISSUE,
  duplicateCandidates,
  mergeVerdicts,
  parseVerdict,
  reviewerLines
};
