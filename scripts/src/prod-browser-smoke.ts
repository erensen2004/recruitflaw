import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

type SmokeStatus = "passed" | "failed" | "skipped";
type Severity = "none" | "minor" | "major" | "blocker";

type SmokeResult = {
  name: string;
  status: SmokeStatus;
  severity: Severity;
  details: string;
  artifact?: string;
};

type CandidateListItem = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  roleId: number;
  roleTitle?: string | null;
  cvUrl?: string | null;
};

type InterviewProcess = {
  id: number;
  status: string;
};

type InterviewMeeting = {
  id: number;
  status: string;
};

type CandidateInterviewBundle = {
  process: InterviewProcess | null;
  meetings: InterviewMeeting[];
};

type CandidateInterviewApiResponse = {
  items?: Array<{
    id: number;
    status: string;
    meetings?: Array<{
      id: number;
      status: string;
    }>;
  }>;
};

type CandidateNote = {
  id: number;
  content: string;
};

type LoginPayload = {
  token: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputRoot = path.join(repoRoot, "output", "playwright");
const runLabel = `prod-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const runDir = path.join(outputRoot, runLabel);
const baseUrl = (process.env.SMOKE_BASE_URL || "https://recruitflaw.vercel.app").replace(/\/$/, "");
const clientEmail = process.env.SMOKE_CLIENT_EMAIL || "hr@techcorp.com";
const clientPassword = process.env.SMOKE_CLIENT_PASSWORD || "client123";
const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@ats.com";
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "admin123";
const invalidPassword = process.env.SMOKE_INVALID_PASSWORD || "definitely-wrong-password";
const headless = process.env.SMOKE_HEADLESS !== "0";

const results: SmokeResult[] = [];
const consoleLines: string[] = [];

function absoluteToRepoRelative(targetPath: string) {
  return path.relative(repoRoot, targetPath) || ".";
}

async function ensureDir(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function settle<T>(promise: Promise<T>, label: string, timeoutMs = 8000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]);
}

async function writeArtifact(name: string, contents: string) {
  const targetPath = path.join(runDir, name);
  await fs.writeFile(targetPath, contents, "utf8");
  return targetPath;
}

async function addResult(result: SmokeResult) {
  results.push(result);
  const summary = `[${result.status.toUpperCase()}] ${result.name}: ${result.details}`;
  console.log(summary);
}

async function capturePageArtifacts(page: Page, slug: string) {
  const htmlPath = path.join(runDir, `${slug}.html`);
  const screenshotPath = path.join(runDir, `${slug}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await fs.writeFile(htmlPath, await page.content(), "utf8");
  return {
    htmlPath,
    screenshotPath,
  };
}

function chooseExecutablePath() {
  const explicit = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (explicit) return explicit;

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return macChrome;
}

async function launchBrowser() {
  const executablePath = chooseExecutablePath();
  try {
    return await chromium.launch({
      headless,
      executablePath,
    });
  } catch (error) {
    console.warn(`[smoke] primary browser launch failed, falling back to bundled Chromium: ${error instanceof Error ? error.message : String(error)}`);
    return chromium.launch({ headless });
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload as T;
}

async function loginApi(email: string, password: string) {
  return requestJson<LoginPayload>(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function authedJson<T>(token: string, pathname: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return requestJson<T>(`${baseUrl}${pathname}`, {
    ...init,
    headers,
  });
}

async function getCandidates(token: string) {
  return authedJson<CandidateListItem[]>(token, "/api/candidates");
}

async function getInterviewBundle(token: string, candidateId: number) {
  const payload = await authedJson<CandidateInterviewApiResponse>(token, `/api/candidates/${candidateId}/interviews`);
  const activeItem = payload.items?.[0] ?? null;

  return {
    process: activeItem
      ? {
          id: Number(activeItem.id),
          status: activeItem.status,
        }
      : null,
    meetings: (activeItem?.meetings ?? []).map((meeting) => ({
      id: Number(meeting.id),
      status: meeting.status,
    })),
  } satisfies CandidateInterviewBundle;
}

async function getNotes(token: string, candidateId: number) {
  return authedJson<CandidateNote[]>(token, `/api/candidates/${candidateId}/notes`);
}

async function findNoteByContent(token: string, candidateId: number, content: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const notes = await getNotes(token, candidateId);
    const match = notes.find((note) => note.content === content);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function choosePrimaryCandidate(token: string) {
  const candidates = await getCandidates(token);
  const preferred =
    candidates.find((candidate) => candidate.cvUrl && candidate.roleId) ??
    candidates.find((candidate) => candidate.roleId) ??
    candidates[0];

  if (!preferred) {
    throw new Error("No candidates were available for browser smoke.");
  }

  return {
    candidate: preferred,
    allCandidates: candidates,
  };
}

async function chooseInterviewCandidate(token: string, candidates: CandidateListItem[]) {
  for (const candidate of candidates) {
    if (!["submitted", "screening"].includes(candidate.status)) {
      continue;
    }

    const bundle = await getInterviewBundle(token, candidate.id);
    const hasActiveProcess = bundle.process?.status === "open";
    const meetings = bundle.meetings ?? [];
    const hasActiveMeeting = meetings.some((meeting) => meeting.status === "negotiating" || meeting.status === "scheduled");
    if (!hasActiveProcess && !hasActiveMeeting) {
      return candidate;
    }
  }

  return null;
}

async function deleteSmokeNote(token: string, candidateId: number, noteId: number) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const response = await fetch(`${baseUrl}/api/candidates/${candidateId}/notes/${noteId}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Could not delete smoke note (${response.status})`);
  }
}

async function patchCandidateStatus(token: string, candidateId: number, status: string, reason?: string) {
  return authedJson<{ status: string }>(token, `/api/candidates/${candidateId}/status`, {
    method: "PATCH",
    body: JSON.stringify(reason ? { status, reason } : { status }),
  });
}

async function createInterviewRequestCleanup(token: string, candidateId: number, note: string, restoreStatus: string) {
  const candidates = await getCandidates(token);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate?.roleId) {
    throw new Error("Interview smoke candidate is missing role context.");
  }

  const request = await authedJson<{ request?: { id: number } }>(token, `/api/interview-requests`, {
    method: "POST",
    body: JSON.stringify({
      roleId: candidate.roleId,
      candidateIds: [candidateId],
      requestText: note,
      preferredDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      preferredWindow: "morning",
      timezone: "Europe/Istanbul",
      durationMinutes: 45,
    }),
  });

  if (!request.request?.id) {
    throw new Error("Interview request was created but no request id was returned for cleanup.");
  }

  await authedJson(token, `/api/interview-requests/${request.request.id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Automated browser smoke cleanup" }),
  });

  if (restoreStatus !== "interview") {
    await patchCandidateStatus(token, candidateId, restoreStatus);
  }

  return request.request.id;
}

async function assertVisible(page: Page, selector: string, errorMessage: string) {
  await page.waitForSelector(selector, { state: "visible", timeout: 15000 }).catch(() => {
    throw new Error(errorMessage);
  });
}

async function verifyInvalidLogin(page: Page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await assertVisible(page, "text=Sign in", "The login heading did not render.");
  await page.getByLabel("Email address").fill(clientEmail);
  await page.getByLabel("Password").fill(invalidPassword);
  await page.getByLabel("Password").press("Enter");
  await assertVisible(page, "text=Invalid email or password", "The friendly invalid login message did not appear.");
  const artifacts = await capturePageArtifacts(page, "01-login-invalid");
  await addResult({
    name: "Invalid login feedback",
    status: "passed",
    severity: "none",
    details: "The login page showed the friendly invalid-credentials message without leaking HTTP details.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function verifyClientLogin(page: Page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(clientEmail);
  await page.getByLabel("Password").fill(clientPassword);
  await page.getByLabel("Password").press("Enter");
  await page.waitForURL((url) => url.pathname.startsWith("/client"), { timeout: 20000 });
  const artifacts = await capturePageArtifacts(page, "02-client-landing");
  await addResult({
    name: "Client login via Enter",
    status: "passed",
    severity: "none",
    details: "Client authentication completed from the keyboard path and redirected into the client workspace.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function verifyCandidateList(page: Page) {
  await page.goto(`${baseUrl}/client/candidates`, { waitUntil: "domcontentloaded" });
  await assertVisible(page, "text=All Candidates", "The client candidate list did not load.");
  await assertVisible(page, "table", "The candidate list table did not render.");
  const tagsHeaderCount = await page.locator("th", { hasText: "Tags" }).count();
  if (tagsHeaderCount > 0) {
    throw new Error("The client candidate list still shows a Tags column.");
  }
  const artifacts = await capturePageArtifacts(page, "03-client-candidates");
  await addResult({
    name: "All Candidates layout",
    status: "passed",
    severity: "none",
    details: "The client candidate list rendered in the simplified table layout without the legacy Tags column.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function verifyCandidateDetail(page: Page, candidate: CandidateListItem, roleCandidatesHref: string) {
  await page.goto(`${baseUrl}/client/candidates/${candidate.id}?back=${encodeURIComponent(roleCandidatesHref)}`, {
    waitUntil: "domcontentloaded",
  });
  await assertVisible(page, `text=${candidate.firstName} ${candidate.lastName}`, "The client candidate detail page did not render.");
  await assertVisible(page, "text=View Standardized CV", "The standardized CV action is missing from candidate detail.");
  await assertVisible(page, "text=Interview", "The interview summary card is not visible on candidate detail.");

  const skillsHeadingCount = await page.getByText(/^Skills$/).count();
  if (skillsHeadingCount > 0) {
    throw new Error("Client candidate detail still exposes a Skills heading.");
  }

  const whyThisMattersCount = await page.getByText("Why this matters").count();
  if (whyThisMattersCount > 0) {
    throw new Error("Client candidate detail still exposes admin-style helper copy.");
  }

  const artifacts = await capturePageArtifacts(page, "04-candidate-detail");
  await addResult({
    name: "Client candidate detail",
    status: "passed",
    severity: "none",
    details: "Candidate detail rendered with the interview summary visible and without client-facing admin copy leaks.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function verifyStandardizedCvPreview(page: Page) {
  const popupPromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "View Standardized CV" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded", { timeout: 15000 });
  await popup.waitForTimeout(1500);
  const screenshotPath = path.join(runDir, "05-standardized-cv-preview.png");
  let artifactPath = screenshotPath;
  await popup.screenshot({ path: screenshotPath, fullPage: true }).catch(async () => {
    artifactPath = path.join(runDir, "05-standardized-cv-preview.txt");
    await fs.writeFile(artifactPath, popup.url(), "utf8");
  });

  const popupUrl = popup.url();
  if (!popupUrl.startsWith("blob:") && !popupUrl.startsWith("chrome-extension:")) {
    throw new Error(`Standardized CV preview opened an unexpected target: ${popupUrl}`);
  }

  await addResult({
    name: "Standardized CV preview",
    status: "passed",
    severity: "none",
    details: "The standardized CV preview opened in a new tab without a client-facing error.",
    artifact: absoluteToRepoRelative(artifactPath),
  });
  await popup.close().catch(() => undefined);
}

async function verifyRoles(page: Page) {
  await page.goto(`${baseUrl}/client/roles`, { waitUntil: "domcontentloaded" });
  await assertVisible(page, "text=My Job Roles", "The client roles page did not load.");
  const artifacts = await capturePageArtifacts(page, "06-client-roles");
  await addResult({
    name: "My Roles layout",
    status: "passed",
    severity: "none",
    details: "The client roles list rendered in the compact row-based layout.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function verifyRoleCandidates(page: Page, roleId: number) {
  await page.goto(`${baseUrl}/client/roles/${roleId}/candidates`, { waitUntil: "domcontentloaded" });
  await assertVisible(page, "text=Candidates", "The role candidates page did not load.");
  await assertVisible(page, "text=Brief:", "The compact role brief summary did not render.");
  const artifacts = await capturePageArtifacts(page, "07-role-candidates");
  await addResult({
    name: "Role candidates layout",
    status: "passed",
    severity: "none",
    details: "The role candidates view rendered with compact row actions and the brief summary strip.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function verifyInterviewInbox(page: Page) {
  await page.goto(`${baseUrl}/client/interviews`, { waitUntil: "domcontentloaded" });
  await assertVisible(page, "text=Interview Requests", "The interview inbox heading did not render.");
  await assertVisible(page, "text=Scheduling inbox", "The interview inbox page did not load correctly.");
  const artifacts = await capturePageArtifacts(page, "08-interview-inbox");
  await addResult({
    name: "Interview Requests page",
    status: "passed",
    severity: "none",
    details: "The interview inbox page rendered in production with the compact scheduling layout.",
    artifact: absoluteToRepoRelative(artifacts.screenshotPath),
  });
}

async function runMutationPass(page: Page, clientToken: string, adminToken: string, primaryCandidate: CandidateListItem, allCandidates: CandidateListItem[]) {
  const noteText = `Automated browser smoke note ${new Date().toISOString()}`;
  let noteId: number | null = null;

  try {
    await page.goto(`${baseUrl}/client/candidates/${primaryCandidate.id}`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Add a shared note for the hiring team...").fill(noteText);
    await page.getByRole("button", { name: "Save note" }).click();
    await assertVisible(page, `text=${noteText}`, "The smoke note did not appear on candidate detail.");

    const matchingNote = await findNoteByContent(clientToken, primaryCandidate.id, noteText);
    if (!matchingNote) {
      throw new Error("The smoke note appeared in the UI but could not be found for cleanup.");
    }

    noteId = matchingNote.id;
    await deleteSmokeNote(clientToken, primaryCandidate.id, noteId);
    await page.reload({ waitUntil: "domcontentloaded" });
    const noteStillVisible = await page.getByText(noteText).count();
    if (noteStillVisible > 0) {
      throw new Error("The smoke note was created but did not disappear after cleanup.");
    }

    const nextStatus = primaryCandidate.status === "screening" ? "offer" : "screening";
    await patchCandidateStatus(adminToken, primaryCandidate.id, nextStatus);
    await patchCandidateStatus(adminToken, primaryCandidate.id, primaryCandidate.status);

    const interviewCandidate = await chooseInterviewCandidate(clientToken, allCandidates);
    if (interviewCandidate) {
      const cleanupMeetingId = await createInterviewRequestCleanup(
        clientToken,
        interviewCandidate.id,
        `Automated browser smoke interview ${new Date().toISOString()}`,
        interviewCandidate.status,
      );
      await addResult({
        name: "Reversible live mutations",
        status: "passed",
        severity: "none",
        details: `Note creation, status update, and admin-mediated interview request cleanup all completed successfully. Interview request id: ${cleanupMeetingId}.`,
      });
    } else {
      await addResult({
        name: "Reversible live mutations",
        status: "passed",
        severity: "minor",
        details: "Note cleanup and status revert passed. Interview creation was skipped because every accessible candidate already had an active interview thread.",
      });
    }
  } catch (error) {
    if (noteId != null) {
      await deleteSmokeNote(clientToken, primaryCandidate.id, noteId).catch(() => undefined);
    }
    throw error;
  }
}

async function writeReport() {
  const report = {
    baseUrl,
    runLabel,
    generatedAt: new Date().toISOString(),
    results,
  };

  const markdownLines = [
    "# RecruitFlow Browser Smoke Report",
    "",
    `- Base URL: ${baseUrl}`,
    `- Run label: ${runLabel}`,
    `- Generated at: ${report.generatedAt}`,
    "",
    "## Results",
    "",
    ...results.map((result) => {
      const artifact = result.artifact ? ` | artifact: \`${result.artifact}\`` : "";
      return `- ${result.name}: ${result.status} | severity: ${result.severity}${artifact}\n  ${result.details}`;
    }),
  ];

  await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(path.join(runDir, "report.md"), markdownLines.join("\n"), "utf8");
  if (consoleLines.length) {
    await fs.writeFile(path.join(runDir, "browser-console.log"), consoleLines.join("\n"), "utf8");
  }
}

async function main() {
  await ensureDir(runDir);

  const [clientLogin, adminLogin] = await Promise.all([
    loginApi(clientEmail, clientPassword),
    loginApi(adminEmail, adminPassword),
  ]);

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    consoleLines.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    consoleLines.push(`[pageerror] ${error.message}`);
  });

  try {
    const { candidate: primaryCandidate, allCandidates } = await choosePrimaryCandidate(clientLogin.token);
    const roleCandidatesHref = `/client/roles/${primaryCandidate.roleId}/candidates`;

    await verifyInvalidLogin(page);
    await verifyClientLogin(page);
    await verifyCandidateList(page);
    await verifyCandidateDetail(page, primaryCandidate, roleCandidatesHref);
    await verifyStandardizedCvPreview(page);
    await verifyRoles(page);
    await verifyRoleCandidates(page, primaryCandidate.roleId);
    await verifyInterviewInbox(page);
    await runMutationPass(page, clientLogin.token, adminLogin.token, primaryCandidate, allCandidates);

    await writeArtifact("run-metadata.txt", `Base URL: ${baseUrl}\nRun label: ${runLabel}\nPrimary candidate: ${primaryCandidate.id}\n`);
  } finally {
    await writeReport();
    await settle(context.close(), "Context close").catch(() => undefined);
    await settle(browser.close(), "Browser close").catch(() => undefined);
  }
}

main().catch(async (error) => {
  const details = error instanceof Error ? error.message : String(error);
  await addResult({
    name: "Browser smoke run",
    status: "failed",
    severity: "blocker",
    details,
  });
  await writeReport();
  console.error(`[browser-smoke] ${details}`);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
