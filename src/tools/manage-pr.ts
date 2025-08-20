import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";

// Define the schema for tool parameters
export const schema = {
  action: z.enum(["create", "update", "review", "merge", "close"]).describe("PR/MR action to perform"),
  branch: z.string().optional().describe("Branch for the PR (current branch if not specified)"),
  title: z.string().optional().describe("PR title"),
  body: z.string().optional().describe("PR body (use 'auto' to generate from commits)"),
  reviewers: z.array(z.string()).optional().describe("List of reviewers to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply to the PR"),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional().describe("Merge method for completing PR"),
  deleteBranchAfterMerge: z.boolean().optional().describe("Whether to delete branch after merge"),
  prNumber: z.number().optional().describe("PR number for update/review/merge/close actions"),
  comment: z.string().optional().describe("Comment text for review action"),
  reviewAction: z.enum(["approve", "request-changes", "comment"]).optional().describe("Type of review to submit")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "manage_pr",
  description: "Complete PR/MR lifecycle management with platform abstraction for GitHub and GitLab",
  annotations: {
    title: "Manage PR/MR",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
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

// Helper function to detect platform (GitHub or GitLab)
function detectPlatform(): "github" | "gitlab" | "unknown" {
  // Try to get remote URL
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

// Helper function to check if CLI tool is available
function isCliAvailable(cli: string): boolean {
  const result = executeCommand(`which ${cli}`);
  return result.success;
}

// Helper function to check authentication
function checkAuth(platform: string): { authenticated: boolean; error?: string } {
  let result;
  if (platform === "github") {
    result = executeCommand("gh auth status");
  } else if (platform === "gitlab") {
    result = executeCommand("glab auth status");
  } else {
    return { authenticated: false, error: "Unknown platform" };
  }

  return {
    authenticated: result.success && !result.stderr?.includes("not logged in"),
    error: result.success ? undefined : result.error
  };
}

// Helper function to generate commit-based body
function generateBodyFromCommits(branch: string): string {
  const result = executeCommand(`git log --oneline origin/main..${branch}`);
  if (!result.success || !result.stdout.trim()) {
    return "Auto-generated PR description";
  }

  const commits = result.stdout.split("\n").filter(line => line.trim());
  if (commits.length === 0) {
    return "Auto-generated PR description";
  }

  let body = "## Changes\n\n";
  body += commits.map(commit => `- ${commit}`).join("\n");

  // Try to extract any issue references
  const issueRefs = commits
    .join(" ")
    .match(/#\d+|[A-Z]+-\d+/g);

  if (issueRefs && issueRefs.length > 0) {
    body += "\n\n## Related Issues\n\n";
    body += [...new Set(issueRefs)].map(ref => `- ${ref}`).join("\n");
  }

  return body;
}

// Tool implementation
export default async function managePR({
  action,
  branch,
  title,
  body,
  reviewers = [],
  labels = [],
  mergeMethod = "merge",
  deleteBranchAfterMerge = false,
  prNumber,
  comment,
  reviewAction = "comment"
}: InferSchema<typeof schema>) {
  const steps: string[] = [];
  const warnings: string[] = [];

  try {
    // Verify we're in a git repository
    const gitCheckResult = executeCommand("git rev-parse --git-dir");
    if (!gitCheckResult.success) {
      throw new Error("Not in a git repository");
    }

    // Detect platform
    const platform = detectPlatform();
    if (platform === "unknown") {
      throw new Error("Unable to detect platform (GitHub or GitLab) from remote URL");
    }

    steps.push(`Detected platform: ${platform}`);

    // Check CLI availability
    const cliTool = platform === "github" ? "gh" : "glab";
    if (!isCliAvailable(cliTool)) {
      throw new Error(`${cliTool} CLI tool is not installed or not in PATH`);
    }

    // Check authentication
    const authStatus = checkAuth(platform);
    if (!authStatus.authenticated) {
      throw new Error(`Not authenticated with ${platform}. Run '${cliTool} auth login' first.`);
    }

    steps.push(`Authenticated with ${platform}`);

    // Determine working branch
    const currentBranch = getCurrentBranch();
    const workingBranch = branch || currentBranch;

    if (!workingBranch) {
      throw new Error("Cannot determine working branch (detached HEAD and no branch specified)");
    }

    steps.push(`Working branch: ${workingBranch}`);

    // Execute action-specific logic
    switch (action) {
    case "create":
      return await handleCreateAction(platform, workingBranch, title, body, reviewers, labels, steps, warnings);

    case "update":
      return await handleUpdateAction(platform, prNumber, workingBranch, title, body, steps, warnings);

    case "review":
      return await handleReviewAction(platform, prNumber, reviewAction, comment, steps, warnings);

    case "merge":
      return await handleMergeAction(platform, prNumber, mergeMethod, deleteBranchAfterMerge, steps, warnings);

    case "close":
      return await handleCloseAction(platform, prNumber, steps, warnings);

    default:
      throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to ${action} PR: ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }
}

async function handleCreateAction(
  platform: string,
  branch: string,
  title?: string,
  body?: string,
  reviewers: string[] = [],
  labels: string[] = [],
  steps: string[],
  warnings: string[]
) {
  // Ensure branch is pushed to remote
  const pushResult = executeCommand(`git push -u origin ${branch}`);
  if (pushResult.success) {
    steps.push(`Pushed branch ${branch} to remote`);
  } else if (!pushResult.error?.includes("up-to-date")) {
    warnings.push(`Failed to push branch: ${pushResult.error}`);
  }

  // Generate title if not provided
  const prTitle = title || `Feature: ${branch.replace(/^feature\//, "").replace(/-/g, " ")}`;

  // Generate body if requested or not provided
  let prBody = body;
  if (body === "auto" || !body) {
    prBody = generateBodyFromCommits(branch);
  }

  // Build command based on platform
  let createCommand: string;
  if (platform === "github") {
    createCommand = `gh pr create --title "${prTitle}" --body "${prBody}"`;
    if (reviewers.length > 0) {
      createCommand += ` --reviewer ${reviewers.join(",")}`;
    }
    if (labels.length > 0) {
      createCommand += ` --label ${labels.join(",")}`;
    }
  } else { // gitlab
    createCommand = `glab mr create --title "${prTitle}" --description "${prBody}"`;
    if (reviewers.length > 0) {
      createCommand += ` --reviewer ${reviewers.join(",")}`;
    }
    if (labels.length > 0) {
      createCommand += ` --label ${labels.join(",")}`;
    }
  }

  const createResult = executeCommand(createCommand);
  if (createResult.success) {
    steps.push(`Created ${platform === "github" ? "PR" : "MR"}: ${prTitle}`);

    // Extract URL from output
    const urlMatch = createResult.stdout.match(/https:\/\/[^\s]+/);
    const prUrl = urlMatch ? urlMatch[0] : "URL not found";

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully created ${platform === "github" ? "Pull Request" : "Merge Request"}\n\n` +
                `**Title:** ${prTitle}\n` +
                `**Branch:** ${branch}\n` +
                `**URL:** ${prUrl}\n` +
                (reviewers.length > 0 ? `**Reviewers:** ${reviewers.join(", ")}\n` : "") +
                (labels.length > 0 ? `**Labels:** ${labels.join(", ")}\n` : "") +
                `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
                (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
        }
      ],
    };
  } else {
    throw new Error(`Failed to create ${platform === "github" ? "PR" : "MR"}: ${createResult.error}`);
  }
}

async function handleUpdateAction(
  platform: string,
  prNumber?: number,
  branch?: string,
  title?: string,
  body?: string,
  steps: string[],
  warnings: string[]
) {
  if (!prNumber && !branch) {
    throw new Error("Either PR number or branch must be specified for update action");
  }

  // If no PR number, try to find PR for current branch
  let actualPrNumber = prNumber;
  if (!actualPrNumber && branch) {
    const findCommand = platform === "github"
      ? `gh pr list --head ${branch} --json number --jq '.[0].number'`
      : `glab mr list --source-branch ${branch} --json | jq '.[0].iid'`;

    const findResult = executeCommand(findCommand);
    if (findResult.success && findResult.stdout.trim()) {
      actualPrNumber = parseInt(findResult.stdout.trim());
      steps.push(`Found ${platform === "github" ? "PR" : "MR"} #${actualPrNumber} for branch ${branch}`);
    } else {
      throw new Error(`No ${platform === "github" ? "PR" : "MR"} found for branch ${branch}`);
    }
  }

  if (!actualPrNumber) {
    throw new Error("Could not determine PR number");
  }

  // Push latest changes if branch specified
  if (branch) {
    const pushResult = executeCommand(`git push origin ${branch}`);
    if (pushResult.success) {
      steps.push(`Pushed latest changes for branch ${branch}`);
    } else if (!pushResult.error?.includes("up-to-date")) {
      warnings.push(`Failed to push changes: ${pushResult.error}`);
    }
  }

  // Update title/body if provided
  if (title || body) {
    let updateCommand = platform === "github"
      ? `gh pr edit ${actualPrNumber}`
      : `glab mr update ${actualPrNumber}`;

    if (title) {
      updateCommand += platform === "github" ? ` --title "${title}"` : ` --title "${title}"`;
    }
    if (body) {
      const actualBody = body === "auto" && branch ? generateBodyFromCommits(branch) : body;
      updateCommand += platform === "github" ? ` --body "${actualBody}"` : ` --description "${actualBody}"`;
    }

    const updateResult = executeCommand(updateCommand);
    if (updateResult.success) {
      steps.push(`Updated ${platform === "github" ? "PR" : "MR"} #${actualPrNumber} metadata`);
    } else {
      warnings.push(`Failed to update metadata: ${updateResult.error}`);
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `✅ Successfully updated ${platform === "github" ? "PR" : "MR"} #${actualPrNumber}\n\n` +
              `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
      }
    ],
  };
}

async function handleReviewAction(
  platform: string,
  prNumber?: number,
  reviewAction: string = "comment",
  comment?: string,
  steps: string[],
  warnings: string[]
) {
  if (!prNumber) {
    throw new Error("PR number is required for review action");
  }

  if (!comment) {
    throw new Error("Comment is required for review action");
  }

  let reviewCommand: string;
  if (platform === "github") {
    switch (reviewAction) {
    case "approve":
      reviewCommand = `gh pr review ${prNumber} --approve --body "${comment}"`;
      break;
    case "request-changes":
      reviewCommand = `gh pr review ${prNumber} --request-changes --body "${comment}"`;
      break;
    default:
      reviewCommand = `gh pr review ${prNumber} --comment --body "${comment}"`;
    }
  } else { // gitlab
    // GitLab CLI has different review semantics
    reviewCommand = `glab mr note ${prNumber} --message "${comment}"`;
    if (reviewAction === "approve") {
      reviewCommand += ` && glab mr approve ${prNumber}`;
    }
  }

  const reviewResult = executeCommand(reviewCommand);
  if (reviewResult.success) {
    steps.push(`Submitted ${reviewAction} review for ${platform === "github" ? "PR" : "MR"} #${prNumber}`);

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully submitted ${reviewAction} review for ${platform === "github" ? "PR" : "MR"} #${prNumber}\n\n` +
                `**Review type:** ${reviewAction}\n` +
                `**Comment:** ${comment}\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to submit review: ${reviewResult.error}`);
  }
}

async function handleMergeAction(
  platform: string,
  prNumber?: number,
  mergeMethod: string = "merge",
  deleteBranchAfterMerge: boolean = false,
  steps: string[],
  warnings: string[]
) {
  if (!prNumber) {
    throw new Error("PR number is required for merge action");
  }

  let mergeCommand: string;
  if (platform === "github") {
    mergeCommand = `gh pr merge ${prNumber}`;
    switch (mergeMethod) {
    case "squash":
      mergeCommand += " --squash";
      break;
    case "rebase":
      mergeCommand += " --rebase";
      break;
    default:
      mergeCommand += " --merge";
    }
    if (deleteBranchAfterMerge) {
      mergeCommand += " --delete-branch";
    }
  } else { // gitlab
    mergeCommand = `glab mr merge ${prNumber}`;
    // GitLab CLI has different merge options
  }

  const mergeResult = executeCommand(mergeCommand);
  if (mergeResult.success) {
    steps.push(`Merged ${platform === "github" ? "PR" : "MR"} #${prNumber} using ${mergeMethod} strategy`);

    if (deleteBranchAfterMerge) {
      steps.push("Deleted source branch");
    }

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully merged ${platform === "github" ? "PR" : "MR"} #${prNumber}\n\n` +
                `**Merge method:** ${mergeMethod}\n` +
                `**Branch deleted:** ${deleteBranchAfterMerge ? "Yes" : "No"}\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to merge: ${mergeResult.error}`);
  }
}

async function handleCloseAction(
  platform: string,
  prNumber?: number,
  steps: string[],
  warnings: string[]
) {
  if (!prNumber) {
    throw new Error("PR number is required for close action");
  }

  const closeCommand = platform === "github"
    ? `gh pr close ${prNumber}`
    : `glab mr close ${prNumber}`;

  const closeResult = executeCommand(closeCommand);
  if (closeResult.success) {
    steps.push(`Closed ${platform === "github" ? "PR" : "MR"} #${prNumber}`);

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully closed ${platform === "github" ? "PR" : "MR"} #${prNumber}\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to close: ${closeResult.error}`);
  }
}
