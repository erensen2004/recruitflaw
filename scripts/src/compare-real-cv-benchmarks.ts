import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type BenchmarkSummary = {
  result: string;
  files: number;
  baseUrl: string;
  jsonReport: string;
  markdownReport: string;
  averageScore: string;
  liquidVerdict: string;
};

type AggregateReport = {
  generatedAt: string;
  baseUrl: string;
  corpusPath: string;
  files: Array<{
    metadata: { fileName: string; format: string };
    totalScore: number;
    totalMax: number;
    classification: "good" | "usable but thin" | "needs review" | "fails recruiter brief quality";
    weakZones: string[];
    extractionDebug: {
      method: string | null;
      failureClass: string | null;
    };
    output: {
      executiveHeadline?: string | null;
      professionalSnapshot?: string | null;
      candidateStrengths?: string[] | null;
      notableAchievements?: string[] | null;
      standardizedProfile?: string | null;
    };
  }>;
  totals: {
    files: number;
    averageScore: string;
    classifications: Record<string, number>;
  };
  recurringWeakZones: Array<{ zone: string; count: number }>;
  recurringStructuredThinFlags: Array<{ flag: string; count: number }>;
  recurringExtractionFailures: Array<{ failureClass: string; count: number }>;
  recurringWarnings: Array<{ warning: string; count: number }>;
  liquidVerdict: {
    decision: string;
    reasons: string[];
  };
};

const WORKSPACE_ROOT = path.resolve(process.cwd(), "..");
const REPORTS_DIR = path.resolve(WORKSPACE_ROOT, ".local/benchmark-reports");
const BASELINE_URL = process.env.RECRUITFLOW_BASELINE_BASE_URL || "http://127.0.0.1:8080";
const VARIANT_URL = process.env.RECRUITFLOW_VARIANT_BASE_URL || "http://127.0.0.1:8081";
const PROMOTION_THRESHOLD = Number(process.env.RECRUITFLOW_VERTEX_PROMOTION_THRESHOLD || "5");

function parseAverageScore(value: string) {
  return Number(value.split("/")[0] || "0");
}

async function runBenchmark(baseUrl: string, label: string, extraEnv?: Record<string, string>) {
  return await new Promise<BenchmarkSummary>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/scripts", "exec", "tsx", "./src/benchmark-real-cv-corpus.ts"],
      {
        cwd: path.resolve(WORKSPACE_ROOT),
        env: {
          ...process.env,
          RECRUITFLOW_CV_PARSE_BASE_URL: baseUrl,
          RECRUITFLOW_BENCHMARK_LABEL: label,
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} benchmark exited with code ${code}\n${stderr}`));
        return;
      }

      const match = stdout.match(/\{\s*"result"[\s\S]*\}\s*$/);
      if (!match) {
        reject(new Error(`${label} benchmark did not emit a JSON summary.`));
        return;
      }

      try {
        resolve(JSON.parse(match[0]) as BenchmarkSummary);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function formatDelta(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function topWeakZoneDiff(baseline: AggregateReport, variant: AggregateReport) {
  const map = new Map<string, { baseline: number; variant: number }>();
  for (const item of baseline.recurringWeakZones) {
    map.set(item.zone, { baseline: item.count, variant: 0 });
  }
  for (const item of variant.recurringWeakZones) {
    const existing = map.get(item.zone) ?? { baseline: 0, variant: 0 };
    existing.variant = item.count;
    map.set(item.zone, existing);
  }

  return [...map.entries()]
    .map(([zone, counts]) => ({
      zone,
      baseline: counts.baseline,
      variant: counts.variant,
      delta: counts.variant - counts.baseline,
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 8);
}

function pickRepresentativeDiffs(baseline: AggregateReport, variant: AggregateReport) {
  const variantByFile = new Map(variant.files.map((file) => [file.metadata.fileName, file]));
  return baseline.files
    .map((baseFile) => {
      const variantFile = variantByFile.get(baseFile.metadata.fileName);
      if (!variantFile) return null;
      return {
        fileName: baseFile.metadata.fileName,
        format: baseFile.metadata.format,
        baselineScore: baseFile.totalScore,
        variantScore: variantFile.totalScore,
        delta: variantFile.totalScore - baseFile.totalScore,
        baselineHeadline: baseFile.output.executiveHeadline ?? null,
        variantHeadline: variantFile.output.executiveHeadline ?? null,
        baselineSnapshot: baseFile.output.professionalSnapshot ?? null,
        variantSnapshot: variantFile.output.professionalSnapshot ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 4);
}

async function main() {
  const baseline = await runBenchmark(BASELINE_URL, "baseline");
  const variant = await runBenchmark(VARIANT_URL, "vertex");

  const baselineReport = JSON.parse(await fs.readFile(baseline.jsonReport, "utf8")) as AggregateReport;
  const variantReport = JSON.parse(await fs.readFile(variant.jsonReport, "utf8")) as AggregateReport;

  const baselineAverage = parseAverageScore(baselineReport.totals.averageScore);
  const variantAverage = parseAverageScore(variantReport.totals.averageScore);
  const delta = variantAverage - baselineAverage;
  const shouldPromote = delta >= PROMOTION_THRESHOLD;

  const comparison = {
    generatedAt: new Date().toISOString(),
    baseline: {
      baseUrl: baselineReport.baseUrl,
      averageScore: baselineReport.totals.averageScore,
      classifications: baselineReport.totals.classifications,
      liquidVerdict: baselineReport.liquidVerdict,
      report: baseline.jsonReport,
      markdown: baseline.markdownReport,
    },
    variant: {
      baseUrl: variantReport.baseUrl,
      averageScore: variantReport.totals.averageScore,
      classifications: variantReport.totals.classifications,
      liquidVerdict: variantReport.liquidVerdict,
      report: variant.jsonReport,
      markdown: variant.markdownReport,
    },
    delta: {
      averageScore: delta,
      promotionThreshold: PROMOTION_THRESHOLD,
      shouldPromote,
      weakZones: topWeakZoneDiff(baselineReport, variantReport),
      representativeDiffs: pickRepresentativeDiffs(baselineReport, variantReport),
    },
    recommendation: shouldPromote
      ? "Vertex Gemini enrichment exceeded the agreed threshold and is worth a production auth follow-up."
      : "Vertex Gemini enrichment did not clear the agreed threshold yet; keep it local/optional for now.",
  };

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const comparePath = path.join(REPORTS_DIR, `recruitflow-real-cv-benchmark-compare-${stamp}.json`);
  await fs.writeFile(comparePath, JSON.stringify(comparison, null, 2));

  console.log(JSON.stringify({ result: "ok", comparisonReport: comparePath, ...comparison.delta }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
