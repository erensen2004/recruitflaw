import fs from "node:fs/promises";
import path from "node:path";

type BenchmarkSample = {
  name: string;
  text: string;
  expected: {
    firstName?: string;
    lastName?: string;
    emailIncludes?: string;
    phoneIncludes?: string;
    titleIncludes?: string;
    locationIncludes?: string;
    skillIncludes?: string[];
    educationIncludes?: string;
    languagesIncludes?: string;
  };
};

type BenchmarkResult = {
  model: string;
  sample: string;
  score: number;
  maxScore: number;
  latencyMs: number;
  error?: string;
};

const DEFAULT_MODELS = [
  "liquid/lfm-2.5-1.2b-instruct:free",
  "google/gemma-3-27b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
];

function getModels() {
  const configured = process.env.OPENROUTER_MODEL?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return configured?.length ? configured : DEFAULT_MODELS;
}

function scoreField(value: unknown, includes: string | undefined) {
  if (!includes) return 0;
  return String(value ?? "")
    .toLowerCase()
    .includes(includes.toLowerCase())
    ? 1
    : 0;
}

function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  if (candidate.startsWith("{")) {
    return JSON.parse(candidate) as Record<string, unknown>;
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  }

  throw new Error("Model did not return JSON");
}

async function extractLatheOperatorText() {
  const pdfPath = path.resolve(process.cwd(), "attached_assets/cv-example-lathe-operator_1773474687230.pdf");
  const buffer = await fs.readFile(pdfPath);
  const pdfParseModule = (await import("pdf-parse")) as unknown as {
    PDFParse?: new (options: { data: Buffer }) => {
      getText: () => Promise<{ text?: string }>;
      destroy?: () => Promise<void>;
    };
  };
  const PDFParse = pdfParseModule.PDFParse;
  if (typeof PDFParse !== "function") {
    throw new Error("pdf-parse PDFParse export is not available");
  }
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy?.();
  return (result.text || "").replace(/\s{2,}/g, " ").trim();
}

async function buildSamples(): Promise<BenchmarkSample[]> {
  const latheText = await extractLatheOperatorText().catch(() => "");

  return [
    {
      name: "backend-inline",
      text: [
        "Cansu Yilmaz",
        "Email: cansu.yilmaz@example.com",
        "Phone: +90 532 555 11 22",
        "Location: Istanbul, Turkey",
        "Current Title: Junior Backend Engineer",
        "Experience: 2 years",
        "Skills: JavaScript, TypeScript, Node.js, Express, PostgreSQL, REST APIs",
        "Education: B.Sc. Computer Engineering, Yildiz Technical University, 2024",
        "Languages: Turkish (native), English (B2)",
        "Summary: Junior backend engineer building Node.js and PostgreSQL APIs, comfortable with TypeScript and production bug fixing.",
      ].join("\n"),
      expected: {
        firstName: "Cansu",
        lastName: "Yilmaz",
        emailIncludes: "cansu.yilmaz@example.com",
        phoneIncludes: "532",
        titleIncludes: "backend",
        locationIncludes: "istanbul",
        skillIncludes: ["TypeScript", "Node.js", "PostgreSQL"],
        educationIncludes: "yildiz",
        languagesIncludes: "english",
      },
    },
    ...(latheText
      ? [
          {
            name: "lathe-pdf",
            text: latheText,
            expected: {
              titleIncludes: "operator",
              skillIncludes: ["CNC", "lathe"],
              languagesIncludes: "english",
            },
          } satisfies BenchmarkSample,
        ]
      : []),
  ];
}

async function askModel(model: string, text: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://recruitflaw.vercel.app",
      "X-Title": process.env.OPENROUTER_APP_NAME || "RecruitFlow Benchmark",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 450,
      messages: [
        {
          role: "system",
          content:
            "You are a strict recruiter-safe extraction engine. Return raw JSON only with keys firstName,lastName,email,phone,currentTitle,location,yearsExperience,skills,education,languages,summary.",
        },
        {
          role: "user",
          content: `Resume:\n${text}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Model returned empty content");
  }

  return extractJson(raw);
}

function scoreOutput(output: Record<string, unknown>, sample: BenchmarkSample) {
  const checks = [
    sample.expected.firstName ? output.firstName === sample.expected.firstName : true,
    sample.expected.lastName ? output.lastName === sample.expected.lastName : true,
    scoreField(output.email, sample.expected.emailIncludes) === 1 || !sample.expected.emailIncludes,
    scoreField(output.phone, sample.expected.phoneIncludes) === 1 || !sample.expected.phoneIncludes,
    scoreField(output.currentTitle, sample.expected.titleIncludes) === 1 || !sample.expected.titleIncludes,
    scoreField(output.location, sample.expected.locationIncludes) === 1 || !sample.expected.locationIncludes,
    sample.expected.skillIncludes
      ? sample.expected.skillIncludes.every((skill) => String(output.skills ?? "").toLowerCase().includes(skill.toLowerCase()))
      : true,
    scoreField(output.education, sample.expected.educationIncludes) === 1 || !sample.expected.educationIncludes,
    scoreField(output.languages, sample.expected.languagesIncludes) === 1 || !sample.expected.languagesIncludes,
  ];

  const maxScore = checks.length;
  const score = checks.filter(Boolean).length;
  return { score, maxScore };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  const samples = await buildSamples();
  const models = getModels();
  const results: BenchmarkResult[] = [];

  for (const model of models) {
    for (const sample of samples) {
      const started = Date.now();
      try {
        const output = await askModel(model, sample.text);
        const { score, maxScore } = scoreOutput(output, sample);
        results.push({
          model,
          sample: sample.name,
          score,
          maxScore,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        results.push({
          model,
          sample: sample.name,
          score: 0,
          maxScore: 9,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  const summary = models.map((model) => {
    const modelResults = results.filter((result) => result.model === model);
    const totalScore = modelResults.reduce((sum, result) => sum + result.score, 0);
    const totalMax = modelResults.reduce((sum, result) => sum + result.maxScore, 0);
    const avgLatency = Math.round(
      modelResults.reduce((sum, result) => sum + result.latencyMs, 0) / Math.max(modelResults.length, 1),
    );

    return {
      model,
      score: `${totalScore}/${totalMax}`,
      avgLatencyMs: avgLatency,
      issues: modelResults.filter((result) => result.error).map((result) => `${result.sample}: ${result.error}`),
    };
  });

  summary.sort((left, right) => {
    const [leftScore] = left.score.split("/").map(Number);
    const [rightScore] = right.score.split("/").map(Number);
    return rightScore - leftScore || left.avgLatencyMs - right.avgLatencyMs;
  });

  console.table(summary);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
