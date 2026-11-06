// Explainable, entirely local prioritisation. No hiring probability or model call.
(() => {
  const groups = [
    ["AWS", /\baws\b|amazon web services/i], ["Python", /\bpython\b/i], ["Java", /\bjava\b/i],
    ["TypeScript", /typescript/i], ["JavaScript", /javascript|node\.?js/i], ["React", /\breact\b/i],
    ["Docker", /\bdocker\b|containers?/i], ["Kubernetes", /kubernetes|\beks\b|\bk8s\b/i],
    ["Terraform", /terraform|infraestructura como c[oó]digo/i], ["Lambda", /\blambda\b|serverless/i],
    ["DynamoDB", /dynamodb/i], ["SQL", /\bsql\b|postgres|mysql/i], ["GCP", /\bgcp\b|google cloud/i],
    ["Azure", /\bazure\b/i], ["CI/CD", /ci\/cd|github actions|devops/i],
    ["IA", /\bai\b|\bia\b|machine learning|inteligencia artificial|\bllm\b/i],
    ["Backend", /back.?end|microservicios/i], ["Frontend", /front.?end|interfaces web/i],
  ];
  const terms = (text) => groups.filter(([, re]) => re.test(text || "")).map(([name]) => name);
  function evaluate(cv, job) {
    if (!cv || !job) return null;
    const mine = new Set(terms(cv));
    const needed = terms(`${job.title} ${job.summary}`);
    const common = needed.filter((term) => mine.has(term));
    const missing = needed.filter((term) => !mine.has(term));
    const locationOk = job.region === "peru" || job.region === "latam-global";
    const coverage = needed.length ? common.length / needed.length : 0;
    const label = !locationOk ? "Revisar país" : common.length >= 3 && coverage >= 0.55 ? "Afinidad alta" : common.length >= 1 ? "Afinidad parcial" : "Sin evidencia suficiente";
    return { label, rank: !locationOk ? 0 : label === "Afinidad alta" ? 3 : label === "Afinidad parcial" ? 2 : 1, common: common.slice(0, 5), missing: missing.slice(0, 3), locationOk };
  }
  globalThis.JobMatch = { evaluate, terms };
})();
