import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";

// Define the schema for tool parameters
export const schema = {
  branch: z.string().describe("Branch name to prepare"),
  base: z.string().optional().describe("Base branch to sync from (default: develop)"),
  action: z.enum(["create", "checkout", "sync"]).describe("Action to perform on the branch"),
  syncStrategy: z.enum(["rebase", "merge"]).optional().describe("Strategy for syncing with base branch"),
  stashChanges: z.boolean().optional().describe("Whether to stash uncommitted changes before switching"),
  pushToRemote: z.boolean().optional().describe("Whether to push the branch to remote and set up tracking")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "prepare_branch",
  description: "Create, checkout, or sync branches intelligently with automatic handling of common git operations",
  annotations: {
    title: "Prepare Branch",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

// Helper function to execute git commands safely
function executeGitCommand(command: string): { stdout: string; success: boolean; error?: string } {
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

// Helper function to check if branch exists locally
function branchExistsLocally(branchName: string): boolean {
  const result = executeGitCommand(`git branch --list "${branchName}"`);
  return result.success && result.stdout.includes(branchName);
}

// Helper function to check if branch exists on remote
function branchExistsOnRemote(branchName: string): boolean {
  const result = executeGitCommand(`git ls-remote --heads origin ${branchName}`);
  return result.success && result.stdout.trim().length > 0;
}

// Helper function to get current branch
function getCurrentBranch(): string | null {
  const result = executeGitCommand("git branch --show-current");
  return result.success ? result.stdout : null;
}

// Helper function to check if working directory is clean
function isWorkingDirectoryClean(): boolean {
  const result = executeGitCommand("git status --porcelain");
  return result.success && result.stdout.trim() === "";
}

// Tool implementation
export default async function prepareBranch({
  branch,
  base = "develop",
  action,
  syncStrategy = "rebase",
  stashChanges = true,
  pushToRemote = false
}: InferSchema<typeof schema>) {
  const steps: string[] = [];
  const warnings: string[] = [];
  let stashCreated = false;

  try {
    // Verify we're in a git repository
    const gitCheckResult = executeGitCommand("git rev-parse --git-dir");
    if (!gitCheckResult.success) {
      throw new Error("Not in a git repository");
    }

    const currentBranch = getCurrentBranch();
    steps.push(`Current branch: ${currentBranch || "detached HEAD"}`);

    // Handle uncommitted changes
    if (!isWorkingDirectoryClean() && stashChanges && action !== "sync") {
      const stashResult = executeGitCommand("git stash push -m 'Auto-stash by prepare_branch'");
      if (stashResult.success) {
        steps.push("Stashed uncommitted changes");
        stashCreated = true;
      } else {
        warnings.push("Failed to stash changes: " + stashResult.error);
      }
    }

    // Fetch latest updates from remote
    const fetchResult = executeGitCommand("git fetch origin");
    if (fetchResult.success) {
      steps.push("Fetched latest updates from remote");
    } else {
      warnings.push("Failed to fetch from remote: " + fetchResult.error);
    }

    // Execute action-specific logic
    switch (action) {
    case "create":
      await handleCreateAction(branch, base, steps, warnings, syncStrategy);
      break;

    case "checkout":
      await handleCheckoutAction(branch, base, steps, warnings, syncStrategy);
      break;

    case "sync":
      await handleSyncAction(branch, base, steps, warnings, syncStrategy);
      break;
    }

    // Push to remote if requested
    if (pushToRemote && action !== "sync") {
      await handlePushToRemote(branch, steps, warnings);
    }

    // Restore stashed changes if we're on the same branch
    if (stashCreated && getCurrentBranch() === branch) {
      const stashPopResult = executeGitCommand("git stash pop");
      if (stashPopResult.success) {
        steps.push("Restored previously stashed changes");
      } else {
        warnings.push("Failed to restore stashed changes - they remain in stash");
      }
    }

    const finalBranch = getCurrentBranch();

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully ${action === "create" ? "created" : action === "checkout" ? "checked out" : "synced"} branch "${branch}"\n\n` +
                `**Current branch:** ${finalBranch}\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
                (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
        }
      ],
    };

  } catch (error: any) {
    // If we created a stash, try to restore it
    if (stashCreated) {
      executeGitCommand("git stash pop");
    }

    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to ${action} branch "${branch}": ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }
}

async function handleCreateAction(branch: string, base: string, steps: string[], warnings: string[], syncStrategy: string) {
  // Check if branch already exists
  if (branchExistsLocally(branch)) {
    throw new Error(`Branch "${branch}" already exists locally`);
  }

  // Ensure base branch exists and is up to date
  if (branchExistsOnRemote(base)) {
    const baseCheckoutResult = executeGitCommand(`git checkout ${base}`);
    if (baseCheckoutResult.success) {
      steps.push(`Checked out base branch: ${base}`);

      const pullResult = executeGitCommand(`git pull origin ${base}`);
      if (pullResult.success) {
        steps.push("Updated base branch with latest changes");
      } else {
        warnings.push(`Failed to update base branch: ${pullResult.error}`);
      }
    } else {
      warnings.push(`Failed to checkout base branch: ${baseCheckoutResult.error}`);
    }
  }

  // Create and checkout new branch
  const createResult = executeGitCommand(`git checkout -b ${branch}`);
  if (createResult.success) {
    steps.push(`Created and checked out new branch: ${branch}`);
  } else {
    throw new Error(`Failed to create branch: ${createResult.error}`);
  }
}

async function handleCheckoutAction(branch: string, base: string, steps: string[], warnings: string[], syncStrategy: string) {
  // Check if branch exists locally
  if (branchExistsLocally(branch)) {
    const checkoutResult = executeGitCommand(`git checkout ${branch}`);
    if (checkoutResult.success) {
      steps.push(`Checked out existing local branch: ${branch}`);
    } else {
      throw new Error(`Failed to checkout local branch: ${checkoutResult.error}`);
    }
  } else if (branchExistsOnRemote(branch)) {
    // Branch exists on remote, create local tracking branch
    const checkoutResult = executeGitCommand(`git checkout -b ${branch} origin/${branch}`);
    if (checkoutResult.success) {
      steps.push(`Created local tracking branch from remote: ${branch}`);
    } else {
      throw new Error(`Failed to checkout remote branch: ${checkoutResult.error}`);
    }
  } else {
    throw new Error(`Branch "${branch}" does not exist locally or on remote`);
  }

  // Optionally sync with base branch
  if (base && base !== branch) {
    await handleSyncWithBase(branch, base, steps, warnings, syncStrategy);
  }
}

async function handleSyncAction(branch: string, base: string, steps: string[], warnings: string[], syncStrategy: string) {
  const currentBranch = getCurrentBranch();

  // If not already on target branch, checkout first
  if (currentBranch !== branch) {
    if (!branchExistsLocally(branch)) {
      throw new Error(`Branch "${branch}" does not exist locally`);
    }

    const checkoutResult = executeGitCommand(`git checkout ${branch}`);
    if (checkoutResult.success) {
      steps.push(`Checked out branch: ${branch}`);
    } else {
      throw new Error(`Failed to checkout branch: ${checkoutResult.error}`);
    }
  }

  // Sync with base branch
  await handleSyncWithBase(branch, base, steps, warnings, syncStrategy);
}

async function handleSyncWithBase(branch: string, base: string, steps: string[], warnings: string[], syncStrategy: string) {
  // Ensure base branch is up to date
  const fetchResult = executeGitCommand(`git fetch origin ${base}`);
  if (fetchResult.success) {
    steps.push(`Fetched latest ${base} from remote`);
  } else {
    warnings.push(`Failed to fetch ${base}: ${fetchResult.error}`);
  }

  // Perform sync based on strategy
  let syncResult;
  if (syncStrategy === "rebase") {
    syncResult = executeGitCommand(`git rebase origin/${base}`);
    if (syncResult.success) {
      steps.push(`Rebased ${branch} onto origin/${base}`);
    } else {
      // Check if it's a conflict that needs manual resolution
      if (syncResult.error?.includes("conflict")) {
        warnings.push("Rebase conflicts detected. Run 'git status' to see conflicted files.");
        steps.push("Rebase initiated but conflicts need manual resolution");
      } else {
        warnings.push(`Rebase failed: ${syncResult.error}`);
      }
    }
  } else {
    syncResult = executeGitCommand(`git merge origin/${base}`);
    if (syncResult.success) {
      steps.push(`Merged origin/${base} into ${branch}`);
    } else {
      if (syncResult.error?.includes("conflict")) {
        warnings.push("Merge conflicts detected. Run 'git status' to see conflicted files.");
        steps.push("Merge initiated but conflicts need manual resolution");
      } else {
        warnings.push(`Merge failed: ${syncResult.error}`);
      }
    }
  }
}

async function handlePushToRemote(branch: string, steps: string[], warnings: string[]) {
  // Check if remote branch exists
  if (!branchExistsOnRemote(branch)) {
    // Push and set up tracking
    const pushResult = executeGitCommand(`git push -u origin ${branch}`);
    if (pushResult.success) {
      steps.push(`Pushed branch to remote and set up tracking: ${branch}`);
    } else {
      warnings.push(`Failed to push to remote: ${pushResult.error}`);
    }
  } else {
    // Just push to existing remote branch
    const pushResult = executeGitCommand(`git push origin ${branch}`);
    if (pushResult.success) {
      steps.push(`Pushed changes to remote branch: ${branch}`);
    } else {
      warnings.push(`Failed to push to remote: ${pushResult.error}`);
    }
  }
}
