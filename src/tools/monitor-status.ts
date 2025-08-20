import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";

// Define the schema for tool parameters
export const schema = {
  target: z.enum(["pr", "ci", "feedback", "branch", "all"]).describe("What to monitor"),
  branch: z.string().optional().describe("Branch to check status for (current branch if not specified)"),
  prNumber: z.number().optional().describe("Specific PR number to check"),
  includeDetails: z.boolean().optional().describe("Include detailed information in the response"),
  since: z.string().optional().describe("Check for changes since this date/time (ISO format or relative like '1 hour ago')"),
  filterUnresolved: z.boolean().optional().describe("Only show unresolved issues/feedback")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "monitor_status",
  description: "Monitor PR/MR status, CI/CD pipelines, and feedback that needs attention across different platforms",
  annotations: {
    title: "Monitor Status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

// Helper function to execute commands safely
function executeCommand(command: string): { stdout: string; success: boolean; error?: string } {
  try {
    const stdout = execSync(command, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd()
    });
    return { stdout: stdout.trim(), success: true };
  } catch (error: any) {
    return {
      stdout: "",
      success: false,
      error: error.stderr?.toString() || error.message
    };
  }
}

// Helper function to get current branch
function getCurrentBranch(): string | null {
  const result = executeCommand("git branch --show-current");
  return result.success ? result.stdout : null;
}

// Helper function to detect platform
function detectPlatform(): "github" | "gitlab" | "unknown" {
  const result = executeCommand("git remote get-url origin");
  if (!result.success) {return "unknown";}

  const url = result.stdout.toLowerCase();
  if (url.includes("github.com") || url.includes("github")) {
    return "github";
  } else if (url.includes("gitlab.com") || url.includes("gitlab")) {
    return "gitlab";
  }
  return "unknown";
}

// Helper function to check CLI availability
function isCliAvailable(cli: string): boolean {
  const result = executeCommand(`which ${cli}`);
  return result.success;
}

// Tool implementation
export default async function monitorStatus({
  target,
  branch,
  prNumber,
  includeDetails = false,
  since,
  filterUnresolved = true
}: InferSchema<typeof schema>) {
  const steps: string[] = [];
  const warnings: string[] = [];

  try {
    // Verify we're in a git repository
    const gitCheckResult = executeCommand("git rev-parse --git-dir");
    if (!gitCheckResult.success) {
      throw new Error("Not in a git repository");
    }

    // Determine working branch
    const currentBranch = getCurrentBranch();
    const workingBranch = branch || currentBranch;

    if (!workingBranch && target !== "all") {
      throw new Error("Cannot determine working branch (detached HEAD and no branch specified)");
    }

    // Detect platform
    const platform = detectPlatform();
    if (platform === "unknown") {
      throw new Error("Unable to detect platform (GitHub or GitLab) from remote URL");
    }

    // Check CLI availability
    const cliTool = platform === "github" ? "gh" : "glab";
    if (!isCliAvailable(cliTool)) {
      throw new Error(`${cliTool} CLI tool is not installed or not in PATH`);
    }

    steps.push(`Platform: ${platform}`);
    if (workingBranch) {
      steps.push(`Working branch: ${workingBranch}`);
    }

    // Execute monitoring based on target
    switch (target) {
    case "pr":
      return await monitorPRStatus(platform, workingBranch, prNumber, includeDetails, steps, warnings);

    case "ci":
      return await monitorCIStatus(platform, workingBranch, includeDetails, steps, warnings);

    case "feedback":
      return await monitorFeedback(platform, workingBranch, prNumber, since, filterUnresolved, includeDetails, steps, warnings);

    case "branch":
      return await monitorBranchStatus(platform, workingBranch, includeDetails, steps, warnings);

    case "all":
      return await monitorAllStatus(platform, workingBranch, includeDetails, steps, warnings);

    default:
      throw new Error(`Unknown target: ${target}`);
    }

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to monitor ${target}: ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }
}

async function monitorPRStatus(
  platform: string,
  branch?: string,
  prNumber?: number,
  includeDetails: boolean = false,
  steps: string[],
  warnings: string[]
) {
  let actualPrNumber = prNumber;

  // Find PR for branch if not specified
  if (!actualPrNumber && branch) {
    const findCommand = platform === "github"
      ? `gh pr list --head ${branch} --json number --jq '.[0].number'`
      : `glab mr list --source-branch ${branch} --json | jq -r '.[0].iid'`;

    const findResult = executeCommand(findCommand);
    if (findResult.success && findResult.stdout.trim() && findResult.stdout !== "null") {
      actualPrNumber = parseInt(findResult.stdout.trim());
      steps.push(`Found ${platform === "github" ? "PR" : "MR"} #${actualPrNumber} for branch ${branch}`);
    } else {
      throw new Error(`No ${platform === "github" ? "PR" : "MR"} found for branch ${branch}`);
    }
  }

  if (!actualPrNumber) {
    throw new Error("Could not determine PR number");
  }

  // Get PR status
  const statusCommand = platform === "github"
    ? `gh pr view ${actualPrNumber} --json state,title,mergeable,reviews,statusCheckRollup`
    : `glab mr view ${actualPrNumber} --json`;

  const statusResult = executeCommand(statusCommand);
  if (!statusResult.success) {
    throw new Error(`Failed to get PR status: ${statusResult.error}`);
  }

  let prStatus;
  try {
    prStatus = JSON.parse(statusResult.stdout);
  } catch {
    // Fallback to text output
    steps.push(`Retrieved ${platform === "github" ? "PR" : "MR"} status`);
    return {
      content: [
        {
          type: "text",
          text: `📋 ${platform === "github" ? "PR" : "MR"} #${actualPrNumber} Status\n\n` +
                `\`\`\`\n${statusResult.stdout}\n\`\`\`\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }

  // Parse status information
  const state = prStatus.state || prStatus.status;
  const title = prStatus.title || "Unknown Title";
  const mergeable = prStatus.mergeable || prStatus.merge_status;

  let statusEmoji = "🟡";
  if (state === "MERGED" || state === "merged") {statusEmoji = "✅";}
  else if (state === "CLOSED" || state === "closed") {statusEmoji = "❌";}
  else if (mergeable === "MERGEABLE" || mergeable === "can_be_merged") {statusEmoji = "🟢";}
  else if (mergeable === "CONFLICTING" || mergeable === "cannot_be_merged") {statusEmoji = "🔴";}

  let summary = `${statusEmoji} **${platform === "github" ? "PR" : "MR"} #${actualPrNumber}:** ${title}\n`;
  summary += `**State:** ${state}\n`;
  summary += `**Mergeable:** ${mergeable || "Unknown"}\n`;

  // Add reviews if available (GitHub)
  if (platform === "github" && prStatus.reviews) {
    const approvals = prStatus.reviews.filter((r: any) => r.state === "APPROVED").length;
    const changesRequested = prStatus.reviews.filter((r: any) => r.state === "CHANGES_REQUESTED").length;
    summary += `**Reviews:** ${approvals} approved, ${changesRequested} requesting changes\n`;
  }

  // Add CI status if available
  if (platform === "github" && prStatus.statusCheckRollup) {
    const checks = prStatus.statusCheckRollup;
    const passed = checks.filter((c: any) => c.conclusion === "SUCCESS").length;
    const failed = checks.filter((c: any) => c.conclusion === "FAILURE").length;
    const pending = checks.filter((c: any) => c.conclusion === null).length;
    summary += `**CI Status:** ${passed} passed, ${failed} failed, ${pending} pending\n`;
  }

  steps.push(`Analyzed ${platform === "github" ? "PR" : "MR"} #${actualPrNumber} status`);

  return {
    content: [
      {
        type: "text",
        text: summary + `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (includeDetails ? `\n\n**Full Details:**\n\`\`\`json\n${JSON.stringify(prStatus, null, 2)}\n\`\`\`` : "")
      }
    ],
  };
}

async function monitorCIStatus(
  platform: string,
  branch?: string,
  includeDetails: boolean = false,
  steps: string[],
  warnings: string[]
) {
  if (!branch) {
    throw new Error("Branch is required for CI monitoring");
  }

  // Get CI status for branch
  let ciCommand: string;
  if (platform === "github") {
    ciCommand = `gh run list --branch ${branch} --limit 10 --json status,conclusion,workflowName,createdAt`;
  } else {
    ciCommand = "glab ci list --pipeline-ids --limit 10 --json";
  }

  const ciResult = executeCommand(ciCommand);
  if (!ciResult.success) {
    throw new Error(`Failed to get CI status: ${ciResult.error}`);
  }

  let ciData;
  try {
    ciData = JSON.parse(ciResult.stdout);
  } catch {
    // Fallback to text parsing
    steps.push(`Retrieved CI status for branch ${branch}`);
    return {
      content: [
        {
          type: "text",
          text: `🔧 CI Status for branch "${branch}"\n\n` +
                `\`\`\`\n${ciResult.stdout}\n\`\`\`\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }

  if (!Array.isArray(ciData) || ciData.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `🔧 No CI runs found for branch "${branch}"\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }

  // Analyze CI runs
  const latestRun = ciData[0];
  let statusEmoji = "🟡";
  const status = latestRun.status || latestRun.conclusion;

  if (status === "success" || status === "SUCCESS") {statusEmoji = "✅";}
  else if (status === "failure" || status === "FAILURE") {statusEmoji = "❌";}
  else if (status === "in_progress" || status === "running") {statusEmoji = "🔄";}

  let summary = `${statusEmoji} **Latest CI Run**\n`;
  summary += `**Status:** ${status}\n`;

  if (latestRun.workflowName) {
    summary += `**Workflow:** ${latestRun.workflowName}\n`;
  }

  if (latestRun.createdAt) {
    summary += `**Started:** ${new Date(latestRun.createdAt).toLocaleString()}\n`;
  }

  // Summary of recent runs
  const recent = ciData.slice(0, 5);
  const passed = recent.filter(r => r.conclusion === "success" || r.status === "SUCCESS").length;
  const failed = recent.filter(r => r.conclusion === "failure" || r.status === "FAILURE").length;
  const pending = recent.filter(r => r.status === "in_progress" || r.status === "running").length;

  summary += `\n**Recent runs (last 5):** ${passed} passed, ${failed} failed, ${pending} in progress\n`;

  steps.push(`Analyzed CI status for branch ${branch}`);

  return {
    content: [
      {
        type: "text",
        text: summary + `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (includeDetails ? `\n\n**All Runs:**\n\`\`\`json\n${JSON.stringify(ciData, null, 2)}\n\`\`\`` : "")
      }
    ],
  };
}

async function monitorFeedback(
  platform: string,
  branch?: string,
  prNumber?: number,
  since?: string,
  filterUnresolved: boolean = true,
  includeDetails: boolean = false,
  steps: string[],
  warnings: string[]
) {
  let actualPrNumber = prNumber;

  // Find PR for branch if not specified
  if (!actualPrNumber && branch) {
    const findCommand = platform === "github"
      ? `gh pr list --head ${branch} --json number --jq '.[0].number'`
      : `glab mr list --source-branch ${branch} --json | jq -r '.[0].iid'`;

    const findResult = executeCommand(findCommand);
    if (findResult.success && findResult.stdout.trim() && findResult.stdout !== "null") {
      actualPrNumber = parseInt(findResult.stdout.trim());
      steps.push(`Found ${platform === "github" ? "PR" : "MR"} #${actualPrNumber} for branch ${branch}`);
    }
  }

  if (!actualPrNumber) {
    throw new Error("Could not determine PR number for feedback monitoring");
  }

  // Get feedback (comments, reviews)
  const feedbackCommand = platform === "github"
    ? `gh pr view ${actualPrNumber} --json comments,reviews`
    : `glab mr view ${actualPrNumber} --json`;

  const feedbackResult = executeCommand(feedbackCommand);
  if (!feedbackResult.success) {
    throw new Error(`Failed to get feedback: ${feedbackResult.error}`);
  }

  let feedbackData;
  try {
    feedbackData = JSON.parse(feedbackResult.stdout);
  } catch {
    steps.push(`Retrieved feedback for ${platform === "github" ? "PR" : "MR"} #${actualPrNumber}`);
    return {
      content: [
        {
          type: "text",
          text: `💬 Feedback for ${platform === "github" ? "PR" : "MR"} #${actualPrNumber}\n\n` +
                `\`\`\`\n${feedbackResult.stdout}\n\`\`\`\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }

  // Analyze feedback
  const comments = feedbackData.comments || [];
  const reviews = feedbackData.reviews || [];

  const unresolvedItems: string[] = [];
  let totalFeedback = 0;

  // Process comments
  for (const comment of comments) {
    totalFeedback++;
    if (filterUnresolved) {
      // Check if comment seems unresolved (contains questions, requests, etc.)
      const text = comment.body || comment.note || "";
      if (text.match(/\?|please|could you|can you|should|TODO|FIXME/i)) {
        unresolvedItems.push(`💬 Comment: ${text.substring(0, 100)}...`);
      }
    }
  }

  // Process reviews (GitHub)
  let approvalsCount = 0;
  let changesRequestedCount = 0;

  for (const review of reviews) {
    totalFeedback++;
    if (review.state === "APPROVED") {
      approvalsCount++;
    } else if (review.state === "CHANGES_REQUESTED") {
      changesRequestedCount++;
      if (filterUnresolved) {
        unresolvedItems.push(`🔴 Changes requested: ${(review.body || "").substring(0, 100)}...`);
      }
    }
  }

  let summary = `💬 **Feedback Summary for ${platform === "github" ? "PR" : "MR"} #${actualPrNumber}**\n\n`;
  summary += `**Total feedback items:** ${totalFeedback}\n`;

  if (platform === "github") {
    summary += `**Reviews:** ${approvalsCount} approved, ${changesRequestedCount} requesting changes\n`;
  }

  if (unresolvedItems.length > 0) {
    summary += `**Unresolved items:** ${unresolvedItems.length}\n\n`;
    summary += unresolvedItems.slice(0, 5).join("\n");
    if (unresolvedItems.length > 5) {
      summary += `\n... and ${unresolvedItems.length - 5} more`;
    }
  } else if (filterUnresolved) {
    summary += "**✅ No unresolved feedback found!**\n";
  }

  steps.push(`Analyzed feedback for ${platform === "github" ? "PR" : "MR"} #${actualPrNumber}`);

  return {
    content: [
      {
        type: "text",
        text: summary + `\n\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (includeDetails ? `\n\n**All Feedback:**\n\`\`\`json\n${JSON.stringify(feedbackData, null, 2)}\n\`\`\`` : "")
      }
    ],
  };
}

async function monitorBranchStatus(
  platform: string,
  branch?: string,
  includeDetails: boolean = false,
  steps: string[],
  warnings: string[]
) {
  if (!branch) {
    throw new Error("Branch is required for branch status monitoring");
  }

  // Get branch information
  const branchInfo: string[] = [];

  // Check if branch exists locally and remotely
  const localExists = executeCommand(`git branch --list ${branch}`).success;
  const remoteExists = executeCommand(`git ls-remote --heads origin ${branch}`).success;

  branchInfo.push(`**Local branch:** ${localExists ? "✅ Exists" : "❌ Not found"}`);
  branchInfo.push(`**Remote branch:** ${remoteExists ? "✅ Exists" : "❌ Not found"}`);

  // Get ahead/behind info if both exist
  if (localExists && remoteExists) {
    const aheadBehind = executeCommand(`git rev-list --left-right --count origin/${branch}...${branch}`);
    if (aheadBehind.success) {
      const [behind, ahead] = aheadBehind.stdout.split("\t").map(n => parseInt(n) || 0);
      branchInfo.push(`**Status:** ${ahead} ahead, ${behind} behind remote`);
    }
  }

  // Check for uncommitted changes if on this branch
  const currentBranch = getCurrentBranch();
  if (currentBranch === branch) {
    const status = executeCommand("git status --porcelain");
    if (status.success) {
      const changes = status.stdout.split("\n").filter(line => line.trim()).length;
      branchInfo.push(`**Working directory:** ${changes === 0 ? "✅ Clean" : `⚠️ ${changes} uncommitted changes`}`);
    }
  }

  // Get last commit info
  const lastCommit = executeCommand(`git log -1 --format="%h %s (%ar)" ${branch}`);
  if (lastCommit.success) {
    branchInfo.push(`**Last commit:** ${lastCommit.stdout}`);
  }

  steps.push(`Analyzed branch status for ${branch}`);

  return {
    content: [
      {
        type: "text",
        text: `🌿 **Branch Status: ${branch}**\n\n` +
              branchInfo.join("\n") +
              `\n\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
      }
    ],
  };
}

async function monitorAllStatus(
  platform: string,
  branch?: string,
  includeDetails: boolean = false,
  steps: string[],
  warnings: string[]
) {
  const results: string[] = [];

  // Monitor branch if specified
  if (branch) {
    try {
      const branchResult = await monitorBranchStatus(platform, branch, false, [], []);
      results.push(branchResult.content[0].text);
    } catch (error: any) {
      warnings.push(`Branch monitoring failed: ${error.message}`);
    }
  }

  // Monitor PR/MR
  try {
    const prResult = await monitorPRStatus(platform, branch, undefined, false, [], []);
    results.push(prResult.content[0].text);
  } catch (error: any) {
    warnings.push(`PR monitoring failed: ${error.message}`);
  }

  // Monitor CI
  if (branch) {
    try {
      const ciResult = await monitorCIStatus(platform, branch, false, [], []);
      results.push(ciResult.content[0].text);
    } catch (error: any) {
      warnings.push(`CI monitoring failed: ${error.message}`);
    }
  }

  // Monitor feedback
  try {
    const feedbackResult = await monitorFeedback(platform, branch, undefined, undefined, true, false, [], []);
    results.push(feedbackResult.content[0].text);
  } catch (error: any) {
    warnings.push(`Feedback monitoring failed: ${error.message}`);
  }

  steps.push("Completed comprehensive status monitoring");

  return {
    content: [
      {
        type: "text",
        text: "📊 **Complete Status Overview**\n\n" +
              results.join("\n\n---\n\n") +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "") +
              `\n\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
      }
    ],
  };
}
