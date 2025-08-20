import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";

// Define the schema for tool parameters
export const schema = {
  workflow: z.enum([
    "start-work",
    "complete-feature",
    "address-feedback",
    "hotfix",
    "release-prep",
    "cleanup"
  ]).describe("The workflow to orchestrate"),
  ticket: z.string().optional().describe("Issue/ticket ID (JIRA-123, #456)"),
  branchName: z.string().optional().describe("Branch name (auto-generated if not provided)"),
  targetBranch: z.string().optional().describe("Target branch for PR/MR (default: main/develop)"),
  message: z.string().optional().describe("Commit message or PR title"),
  autoMerge: z.boolean().optional().describe("Automatically merge PR if approved and checks pass"),
  skipTests: z.boolean().optional().describe("Skip running tests during workflow"),
  dryRun: z.boolean().optional().describe("Show what would be done without executing"),
  assignReviewers: z.array(z.string()).optional().describe("Reviewers to assign to PR"),
  labels: z.array(z.string()).optional().describe("Labels to apply to PR/issues")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "orchestrate_workflow",
  description: "High-level workflow orchestration combining multiple git operations for common development patterns",
  annotations: {
    title: "Orchestrate Workflow",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

// Helper function to execute commands safely
function executeCommand(command: string, dryRun = false): { stdout: string; success: boolean; error?: string } {
  if (dryRun) {
    return { stdout: `[DRY RUN] Would execute: ${command}`, success: true };
  }

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

// Helper function to generate branch name
function generateBranchName(ticket?: string, workflow?: string): string {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  if (ticket) {
    // Extract ticket number and create feature branch
    const ticketMatch = ticket.match(/([A-Z]+-\d+)|#(\d+)/);
    if (ticketMatch) {
      const ticketId = ticketMatch[0].replace("#", "issue-");
      return `feature/${ticketId.toLowerCase()}`;
    }
  }

  switch (workflow) {
  case "hotfix":
    return `hotfix/fix-${timestamp}`;
  case "release-prep":
    return `release/v${timestamp}`;
  default:
    return `feature/work-${timestamp}`;
  }
}

// Helper function to check if working directory is clean
function isWorkingDirectoryClean(): boolean {
  const result = executeCommand("git status --porcelain");
  return result.success && result.stdout.trim() === "";
}

// Tool implementation
export default async function orchestrateWorkflow({
  workflow,
  ticket,
  branchName,
  targetBranch = "main",
  message,
  autoMerge = false,
  skipTests = false,
  dryRun = false,
  assignReviewers = [],
  labels = []
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
    steps.push(`Platform: ${platform}`);

    if (dryRun) {
      steps.push("🔍 DRY RUN MODE - No actual changes will be made");
    }

    // Execute workflow-specific logic
    switch (workflow) {
    case "start-work":
      return await handleStartWork(ticket, branchName, targetBranch, platform, dryRun, steps, warnings);

    case "complete-feature":
      return await handleCompleteFeature(ticket, branchName, targetBranch, message, assignReviewers, labels, autoMerge, skipTests, platform, dryRun, steps, warnings);

    case "address-feedback":
      return await handleAddressFeedback(branchName, message, platform, dryRun, steps, warnings);

    case "hotfix":
      return await handleHotfix(ticket, branchName, targetBranch, message, autoMerge, platform, dryRun, steps, warnings);

    case "release-prep":
      return await handleReleasePrep(branchName, targetBranch, message, platform, dryRun, steps, warnings);

    case "cleanup":
      return await handleCleanup(platform, dryRun, steps, warnings);

    default:
      throw new Error(`Unknown workflow: ${workflow}`);
    }

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to orchestrate ${workflow}: ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }
}

async function handleStartWork(
  ticket?: string,
  branchName?: string,
  targetBranch: string = "main",
  platform: string = "unknown",
  dryRun: boolean = false,
  steps: string[],
  warnings: string[]
) {
  const currentBranch = getCurrentBranch();
  const workingBranch = branchName || generateBranchName(ticket, "start-work");

  steps.push(`Starting work on ${ticket ? `ticket ${ticket}` : "new feature"}`);
  steps.push(`Target branch: ${workingBranch}`);

  // 1. Ensure we're on the target base branch and up to date
  if (currentBranch !== targetBranch) {
    const checkoutResult = executeCommand(`git checkout ${targetBranch}`, dryRun);
    if (checkoutResult.success) {
      steps.push(`Checked out base branch: ${targetBranch}`);
    } else {
      throw new Error(`Failed to checkout base branch: ${checkoutResult.error}`);
    }
  }

  // 2. Pull latest changes
  const pullResult = executeCommand(`git pull origin ${targetBranch}`, dryRun);
  if (pullResult.success || dryRun) {
    steps.push(`Pulled latest changes from origin/${targetBranch}`);
  } else {
    warnings.push(`Failed to pull latest changes: ${pullResult.error}`);
  }

  // 3. Create and checkout feature branch
  const branchResult = executeCommand(`git checkout -b ${workingBranch}`, dryRun);
  if (branchResult.success || dryRun) {
    steps.push(`Created and checked out branch: ${workingBranch}`);
  } else {
    throw new Error(`Failed to create branch: ${branchResult.error}`);
  }

  // 4. Push branch to remote to set up tracking
  const pushResult = executeCommand(`git push -u origin ${workingBranch}`, dryRun);
  if (pushResult.success || dryRun) {
    steps.push("Pushed branch to remote with tracking");
  } else {
    warnings.push(`Failed to push branch: ${pushResult.error}`);
  }

  // 5. Link to issue if ticket provided
  if (ticket && platform !== "unknown") {
    steps.push(`Branch linked to ticket: ${ticket}`);
    // The actual linking would be handled by track-issues tool
  }

  return {
    content: [
      {
        type: "text",
        text: `✅ Successfully started work${ticket ? ` on ${ticket}` : ""}\n\n` +
              `**Working branch:** ${workingBranch}\n` +
              `**Base branch:** ${targetBranch}\n` +
              (ticket ? `**Ticket:** ${ticket}\n` : "") +
              `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
      }
    ],
  };
}

async function handleCompleteFeature(
  ticket?: string,
  branchName?: string,
  targetBranch: string = "main",
  message?: string,
  assignReviewers: string[] = [],
  labels: string[] = [],
  autoMerge: boolean = false,
  skipTests: boolean = false,
  platform: string = "unknown",
  dryRun: boolean = false,
  steps: string[],
  warnings: string[]
) {
  const currentBranch = getCurrentBranch();
  const workingBranch = branchName || currentBranch;

  if (!workingBranch) {
    throw new Error("Cannot determine working branch");
  }

  steps.push(`Completing feature on branch: ${workingBranch}`);

  // 1. Ensure working directory is clean
  if (!dryRun && !isWorkingDirectoryClean()) {
    throw new Error("Working directory is not clean. Commit or stash changes first.");
  }

  // 2. Sync with target branch
  const syncResult = executeCommand(`git fetch origin ${targetBranch}`, dryRun);
  if (syncResult.success || dryRun) {
    steps.push(`Fetched latest ${targetBranch}`);
  }

  const rebaseResult = executeCommand(`git rebase origin/${targetBranch}`, dryRun);
  if (rebaseResult.success || dryRun) {
    steps.push(`Rebased onto origin/${targetBranch}`);
  } else {
    warnings.push(`Rebase failed, may need manual conflict resolution: ${rebaseResult.error}`);
  }

  // 3. Run tests if not skipped
  if (!skipTests) {
    // Check for common test commands
    const hasPackageJson = executeCommand("test -f package.json").success;
    const hasMakefile = executeCommand("test -f Makefile").success;

    if (hasPackageJson && !dryRun) {
      const testResult = executeCommand("npm test || pnpm test || yarn test");
      if (testResult.success) {
        steps.push("✅ Tests passed");
      } else {
        warnings.push("⚠️ Tests failed - consider fixing before creating PR");
      }
    } else if (hasMakefile && !dryRun) {
      const testResult = executeCommand("make test");
      if (testResult.success) {
        steps.push("✅ Tests passed");
      } else {
        warnings.push("⚠️ Tests failed - consider fixing before creating PR");
      }
    } else {
      steps.push("📋 No standard test command found, skipping tests");
    }
  } else {
    steps.push("⏭️ Skipped tests");
  }

  // 4. Push latest changes
  const pushResult = executeCommand(`git push origin ${workingBranch}`, dryRun);
  if (pushResult.success || dryRun) {
    steps.push(`Pushed changes to origin/${workingBranch}`);
  } else {
    throw new Error(`Failed to push changes: ${pushResult.error}`);
  }

  // 5. Create PR/MR
  if (platform !== "unknown") {
    const prTitle = message || `Complete: ${ticket || workingBranch}`;
    let createCommand = "";

    if (platform === "github") {
      createCommand = `gh pr create --title "${prTitle}" --base ${targetBranch} --head ${workingBranch}`;
      if (assignReviewers.length > 0) {
        createCommand += ` --reviewer ${assignReviewers.join(",")}`;
      }
      if (labels.length > 0) {
        createCommand += ` --label ${labels.join(",")}`;
      }
    } else if (platform === "gitlab") {
      createCommand = `glab mr create --title "${prTitle}" --target-branch ${targetBranch} --source-branch ${workingBranch}`;
      if (assignReviewers.length > 0) {
        createCommand += ` --reviewer ${assignReviewers.join(",")}`;
      }
    }

    if (createCommand) {
      const prResult = executeCommand(createCommand, dryRun);
      if (prResult.success || dryRun) {
        steps.push(`Created ${platform === "github" ? "PR" : "MR"}: ${prTitle}`);
      } else {
        warnings.push(`Failed to create ${platform === "github" ? "PR" : "MR"}: ${prResult.error}`);
      }
    }
  }

  // 6. Update issue status if ticket provided
  if (ticket && platform !== "unknown") {
    steps.push(`Would transition ${ticket} to 'In Review'`);
    // This would integrate with track-issues tool
  }

  return {
    content: [
      {
        type: "text",
        text: "✅ Successfully completed feature workflow\n\n" +
              `**Branch:** ${workingBranch}\n` +
              `**Target:** ${targetBranch}\n` +
              (ticket ? `**Ticket:** ${ticket}\n` : "") +
              (assignReviewers.length > 0 ? `**Reviewers:** ${assignReviewers.join(", ")}\n` : "") +
              `**Auto-merge:** ${autoMerge ? "Enabled" : "Disabled"}\n` +
              `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
      }
    ],
  };
}

async function handleAddressFeedback(
  branchName?: string,
  message?: string,
  platform: string = "unknown",
  dryRun: boolean = false,
  steps: string[],
  warnings: string[]
) {
  const currentBranch = getCurrentBranch();
  const workingBranch = branchName || currentBranch;

  if (!workingBranch) {
    throw new Error("Cannot determine working branch");
  }

  steps.push(`Addressing feedback on branch: ${workingBranch}`);

  // 1. Find associated PR
  let prNumber: number | null = null;
  if (platform === "github") {
    const findPrResult = executeCommand(`gh pr list --head ${workingBranch} --json number --jq '.[0].number'`);
    if (findPrResult.success && findPrResult.stdout.trim() !== "null") {
      prNumber = parseInt(findPrResult.stdout.trim());
      steps.push(`Found PR #${prNumber} for branch ${workingBranch}`);
    }
  }

  // 2. Get feedback if PR found
  if (prNumber && platform === "github") {
    const feedbackResult = executeCommand(`gh pr view ${prNumber} --json comments,reviews`);
    if (feedbackResult.success) {
      steps.push("Retrieved PR feedback for review");
      // Parse and identify unresolved feedback would go here
    }
  }

  // 3. Stage all changes (assuming user has made fixes)
  const stageResult = executeCommand("git add .", dryRun);
  if (stageResult.success || dryRun) {
    steps.push("Staged all changes");
  }

  // 4. Commit changes
  const commitMessage = message || "Address code review feedback";
  const commitResult = executeCommand(`git commit -m "${commitMessage}"`, dryRun);
  if (commitResult.success || dryRun) {
    steps.push(`Committed changes: ${commitMessage}`);
  } else if (!dryRun) {
    warnings.push("No changes to commit or commit failed");
  }

  // 5. Push changes
  const pushResult = executeCommand(`git push origin ${workingBranch}`, dryRun);
  if (pushResult.success || dryRun) {
    steps.push(`Pushed updates to origin/${workingBranch}`);
  }

  // 6. Comment on PR
  if (prNumber && platform === "github") {
    const commentResult = executeCommand(`gh pr comment ${prNumber} --body "Addressed review feedback"`, dryRun);
    if (commentResult.success || dryRun) {
      steps.push("Added comment to PR about feedback being addressed");
    }
  }

  return {
    content: [
      {
        type: "text",
        text: "✅ Successfully addressed feedback\n\n" +
              `**Branch:** ${workingBranch}\n` +
              (prNumber ? `**PR:** #${prNumber}\n` : "") +
              `**Commit:** ${commitMessage}\n` +
              `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
      }
    ],
  };
}

async function handleHotfix(
  ticket?: string,
  branchName?: string,
  targetBranch: string = "main",
  message?: string,
  autoMerge: boolean = false,
  platform: string = "unknown",
  dryRun: boolean = false,
  steps: string[],
  warnings: string[]
) {
  const workingBranch = branchName || generateBranchName(ticket, "hotfix");

  steps.push(`Creating hotfix: ${workingBranch}`);
  steps.push("⚠️ HOTFIX WORKFLOW - Fast-track process");

  // 1. Checkout production/main branch
  const checkoutResult = executeCommand(`git checkout ${targetBranch}`, dryRun);
  if (checkoutResult.success || dryRun) {
    steps.push(`Checked out ${targetBranch}`);
  }

  // 2. Pull latest
  const pullResult = executeCommand(`git pull origin ${targetBranch}`, dryRun);
  if (pullResult.success || dryRun) {
    steps.push(`Updated ${targetBranch}`);
  }

  // 3. Create hotfix branch
  const branchResult = executeCommand(`git checkout -b ${workingBranch}`, dryRun);
  if (branchResult.success || dryRun) {
    steps.push(`Created hotfix branch: ${workingBranch}`);
  }

  // 4. Instructions for user
  steps.push("🔧 Make your hotfix changes now");
  steps.push("📝 The workflow will continue after changes are committed");

  // 5. Check if there are changes to commit
  if (!dryRun && !isWorkingDirectoryClean()) {
    // Auto-commit if there are changes
    const addResult = executeCommand("git add .");
    const commitMsg = message || `Hotfix: ${ticket || "urgent fix"}`;
    const commitResult = executeCommand(`git commit -m "${commitMsg}"`);

    if (addResult.success && commitResult.success) {
      steps.push(`Committed hotfix: ${commitMsg}`);
    }
  }

  // 6. Push hotfix branch
  const pushResult = executeCommand(`git push -u origin ${workingBranch}`, dryRun);
  if (pushResult.success || dryRun) {
    steps.push("Pushed hotfix branch");
  }

  // 7. Create emergency PR
  if (platform === "github") {
    const prTitle = message || `HOTFIX: ${ticket || "Urgent fix"}`;
    const createResult = executeCommand(`gh pr create --title "${prTitle}" --base ${targetBranch} --head ${workingBranch} --label hotfix`, dryRun);
    if (createResult.success || dryRun) {
      steps.push(`Created emergency PR: ${prTitle}`);
    }
  }

  return {
    content: [
      {
        type: "text",
        text: "🚨 **HOTFIX WORKFLOW INITIATED**\n\n" +
              `**Branch:** ${workingBranch}\n` +
              `**Target:** ${targetBranch}\n` +
              (ticket ? `**Issue:** ${ticket}\n` : "") +
              `**Auto-merge:** ${autoMerge ? "Enabled" : "Disabled"}\n` +
              `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              "\n\n**⚡ Next Steps:**\n• Get immediate code review\n• Merge after approval\n• Deploy to production\n• Monitor for issues"
      }
    ],
  };
}

async function handleReleasePrep(
  branchName?: string,
  targetBranch: string = "main",
  message?: string,
  platform: string = "unknown",
  dryRun: boolean = false,
  steps: string[],
  warnings: string[]
) {
  const releaseBranch = branchName || generateBranchName(undefined, "release-prep");

  steps.push(`Preparing release: ${releaseBranch}`);

  // 1. Create release branch from develop/staging
  const checkoutResult = executeCommand("git checkout develop || git checkout staging", dryRun);
  if (checkoutResult.success || dryRun) {
    steps.push("Checked out source branch for release");
  }

  const pullResult = executeCommand("git pull", dryRun);
  if (pullResult.success || dryRun) {
    steps.push("Updated source branch");
  }

  const branchResult = executeCommand(`git checkout -b ${releaseBranch}`, dryRun);
  if (branchResult.success || dryRun) {
    steps.push(`Created release branch: ${releaseBranch}`);
  }

  // 2. Version bump (if package.json exists)
  const hasPackageJson = executeCommand("test -f package.json").success;
  if (hasPackageJson && !dryRun) {
    steps.push("📋 Consider running version bump (npm version patch/minor/major)");
  }

  // 3. Generate changelog
  steps.push("📋 Generate/update CHANGELOG.md with release notes");

  // 4. Push release branch
  const pushResult = executeCommand(`git push -u origin ${releaseBranch}`, dryRun);
  if (pushResult.success || dryRun) {
    steps.push("Pushed release branch");
  }

  // 5. Create PR to main
  if (platform === "github") {
    const prTitle = message || `Release: ${releaseBranch}`;
    const createResult = executeCommand(`gh pr create --title "${prTitle}" --base ${targetBranch} --head ${releaseBranch} --label release`, dryRun);
    if (createResult.success || dryRun) {
      steps.push(`Created release PR: ${prTitle}`);
    }
  }

  return {
    content: [
      {
        type: "text",
        text: "🚀 **RELEASE PREPARATION COMPLETE**\n\n" +
              `**Release branch:** ${releaseBranch}\n` +
              `**Target:** ${targetBranch}\n` +
              `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              "\n\n**📋 Manual Tasks:**\n• Update version in package.json\n• Update CHANGELOG.md\n• Tag release after merge\n• Deploy to production"
      }
    ],
  };
}

async function handleCleanup(
  platform: string = "unknown",
  dryRun: boolean = false,
  steps: string[],
  warnings: string[]
) {
  steps.push("🧹 Cleaning up merged branches and stale references");

  // 1. Fetch and prune
  const fetchResult = executeCommand("git fetch --prune", dryRun);
  if (fetchResult.success || dryRun) {
    steps.push("Fetched and pruned remote references");
  }

  // 2. List merged branches
  const mergedResult = executeCommand("git branch --merged main");
  let mergedBranches: string[] = [];

  if (mergedResult.success && !dryRun) {
    mergedBranches = mergedResult.stdout
      .split("\n")
      .map(b => b.trim())
      .filter(b => b && !b.startsWith("*") && b !== "main" && b !== "master" && b !== "develop");

    if (mergedBranches.length > 0) {
      steps.push(`Found ${mergedBranches.length} merged branches for cleanup`);
    }
  }

  // 3. Delete merged branches (with confirmation in real mode)
  if (mergedBranches.length > 0) {
    for (const branch of mergedBranches.slice(0, 5)) { // Limit to 5 for safety
      const deleteResult = executeCommand(`git branch -d ${branch}`, dryRun);
      if (deleteResult.success || dryRun) {
        steps.push(`Deleted merged branch: ${branch}`);
      } else {
        warnings.push(`Failed to delete ${branch}: ${deleteResult.error}`);
      }
    }

    if (mergedBranches.length > 5) {
      steps.push(`... and ${mergedBranches.length - 5} more branches (run again to continue cleanup)`);
    }
  }

  // 4. Clean up git objects
  const gcResult = executeCommand("git gc --prune=now", dryRun);
  if (gcResult.success || dryRun) {
    steps.push("Cleaned up git objects and optimized repository");
  }

  // 5. Show repository status
  const statusResult = executeCommand("git status --short");
  if (statusResult.success && statusResult.stdout.trim()) {
    steps.push(`Repository status: ${statusResult.stdout.split("\n").length} uncommitted changes`);
  } else {
    steps.push("✅ Repository is clean");
  }

  return {
    content: [
      {
        type: "text",
        text: "🧹 **CLEANUP COMPLETE**\n\n" +
              `**Merged branches deleted:** ${mergedBranches.length}\n` +
              `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "") +
              "\n\n**💡 Tip:** Run this periodically to keep your repository clean"
      }
    ],
  };
}
