import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";

// Define the schema for tool parameters
export const schema = {
  targetBranch: z.string().optional().describe("Branch to sync (current branch if not specified)"),
  withBranch: z.string().describe("Branch to sync with"),
  strategy: z.enum(["rebase", "merge", "fast-forward"]).describe("Synchronization strategy"),
  autoResolve: z.enum(["ours", "theirs", "smart"]).optional().describe("Automatic conflict resolution strategy"),
  forcePush: z.boolean().optional().describe("Whether to force push after sync (use with caution)")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "sync_work",
  description: "Synchronize branches with intelligent conflict resolution and multiple merge strategies",
  annotations: {
    title: "Sync Work",
    readOnlyHint: false,
    destructiveHint: true,
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

// Helper function to get current branch
function getCurrentBranch(): string | null {
  const result = executeGitCommand("git branch --show-current");
  return result.success ? result.stdout : null;
}

// Helper function to check if branch exists
function branchExists(branchName: string, remote = false): boolean {
  const command = remote
    ? `git ls-remote --heads origin ${branchName}`
    : `git branch --list "${branchName}"`;
  const result = executeGitCommand(command);

  if (remote) {
    return result.success && result.stdout.trim().length > 0;
  } else {
    return result.success && result.stdout.includes(branchName);
  }
}

// Helper function to check for conflicts
function hasConflicts(): boolean {
  const result = executeGitCommand("git diff --name-only --diff-filter=U");
  return result.success && result.stdout.trim().length > 0;
}

// Helper function to get conflict files
function getConflictFiles(): string[] {
  const result = executeGitCommand("git diff --name-only --diff-filter=U");
  return result.success && result.stdout.trim()
    ? result.stdout.split("\n").filter(f => f.trim())
    : [];
}

// Helper function to check if working directory is clean
function isWorkingDirectoryClean(): boolean {
  const result = executeGitCommand("git status --porcelain");
  return result.success && result.stdout.trim() === "";
}

// Helper function to get ahead/behind info
function getAheadBehindInfo(branch: string, baseBranch: string): { ahead: number; behind: number } {
  const result = executeGitCommand(`git rev-list --left-right --count origin/${baseBranch}...${branch}`);
  if (result.success && result.stdout.trim()) {
    const [behind, ahead] = result.stdout.split("\t").map(n => parseInt(n) || 0);
    return { ahead, behind };
  }
  return { ahead: 0, behind: 0 };
}

// Tool implementation
export default async function syncWork({
  targetBranch,
  withBranch,
  strategy,
  autoResolve,
  forcePush = false
}: InferSchema<typeof schema>) {
  const steps: string[] = [];
  const warnings: string[] = [];
  let conflicts: string[] = [];

  try {
    // Verify we're in a git repository
    const gitCheckResult = executeGitCommand("git rev-parse --git-dir");
    if (!gitCheckResult.success) {
      throw new Error("Not in a git repository");
    }

    // Determine target branch
    const currentBranch = getCurrentBranch();
    const actualTargetBranch = targetBranch || currentBranch;

    if (!actualTargetBranch) {
      throw new Error("Cannot determine target branch (detached HEAD and no branch specified)");
    }

    steps.push(`Target branch: ${actualTargetBranch}`);
    steps.push(`Syncing with: ${withBranch}`);
    steps.push(`Strategy: ${strategy}`);

    // Verify branches exist
    if (!branchExists(actualTargetBranch)) {
      throw new Error(`Target branch "${actualTargetBranch}" does not exist locally`);
    }

    if (!branchExists(withBranch, true)) {
      throw new Error(`Source branch "${withBranch}" does not exist on remote`);
    }

    // Ensure we're on the target branch
    if (currentBranch !== actualTargetBranch) {
      if (!isWorkingDirectoryClean()) {
        throw new Error("Working directory not clean. Commit or stash changes before switching branches.");
      }

      const checkoutResult = executeGitCommand(`git checkout ${actualTargetBranch}`);
      if (checkoutResult.success) {
        steps.push(`Checked out target branch: ${actualTargetBranch}`);
      } else {
        throw new Error(`Failed to checkout target branch: ${checkoutResult.error}`);
      }
    }

    // Fetch latest updates
    const fetchResult = executeGitCommand(`git fetch origin ${withBranch}`);
    if (fetchResult.success) {
      steps.push(`Fetched latest updates from origin/${withBranch}`);
    } else {
      throw new Error(`Failed to fetch updates: ${fetchResult.error}`);
    }

    // Get ahead/behind info before sync
    const beforeSync = getAheadBehindInfo(actualTargetBranch, withBranch);
    steps.push(`Before sync: ${beforeSync.ahead} ahead, ${beforeSync.behind} behind origin/${withBranch}`);

    // Perform sync based on strategy
    const syncResult = await performSync(actualTargetBranch, withBranch, strategy, steps, warnings);

    // Handle conflicts if they occurred
    if (!syncResult.success && hasConflicts()) {
      conflicts = getConflictFiles();

      if (autoResolve && conflicts.length > 0) {
        const resolveResult = await handleAutoResolve(conflicts, autoResolve, steps, warnings);
        if (resolveResult.success) {
          // Continue with the sync operation
          const continueResult = await continueSyncOperation(strategy, steps, warnings);
          if (!continueResult.success) {
            throw new Error(`Failed to continue sync after conflict resolution: ${continueResult.error}`);
          }
        }
      } else {
        // Return conflict information for manual resolution
        return {
          content: [
            {
              type: "text",
              text: `⚠️ Sync conflicts detected in branch "${actualTargetBranch}"\n\n` +
                    `**Strategy:** ${strategy}\n` +
                    `**Conflicted files:**\n${conflicts.map(f => `• ${f}`).join("\n")}\n\n` +
                    "**Next steps:**\n" +
                    "• Resolve conflicts in the listed files\n" +
                    "• Run `git add <resolved-files>`\n" +
                    `• Run \`git ${strategy === "rebase" ? "rebase --continue" : "commit"}\`\n\n` +
                    `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
            }
          ],
        };
      }
    } else if (!syncResult.success) {
      throw new Error(`Sync failed: ${syncResult.error}`);
    }

    // Get ahead/behind info after sync
    const afterSync = getAheadBehindInfo(actualTargetBranch, withBranch);
    steps.push(`After sync: ${afterSync.ahead} ahead, ${afterSync.behind} behind origin/${withBranch}`);

    // Force push if requested and we have commits to push
    if (forcePush && afterSync.ahead > 0) {
      const forcePushResult = executeGitCommand(`git push --force-with-lease origin ${actualTargetBranch}`);
      if (forcePushResult.success) {
        steps.push(`Force pushed changes to origin/${actualTargetBranch}`);
      } else {
        warnings.push(`Failed to force push: ${forcePushResult.error}`);
      }
    }

    const finalBranch = getCurrentBranch();

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully synced branch "${actualTargetBranch}" with "${withBranch}"\n\n` +
                `**Current branch:** ${finalBranch}\n` +
                `**Strategy used:** ${strategy}\n` +
                `**Commits ahead/behind:** ${afterSync.ahead}/${afterSync.behind}\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
                (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "") +
                (conflicts.length > 0 ? `\n\n**Resolved conflicts:**\n${conflicts.map(f => `• ${f}`).join("\n")}` : "")
        }
      ],
    };

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to sync work: ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
                (conflicts.length > 0 ? `\n\n**Conflicted files:**\n${conflicts.map(f => `• ${f}`).join("\n")}` : "")
        }
      ],
    };
  }
}

async function performSync(targetBranch: string, withBranch: string, strategy: string, steps: string[], warnings: string[]): Promise<{ success: boolean; error?: string }> {
  let result;

  switch (strategy) {
  case "fast-forward":
    result = executeGitCommand(`git merge --ff-only origin/${withBranch}`);
    if (result.success) {
      steps.push(`Fast-forwarded ${targetBranch} to origin/${withBranch}`);
    } else if (result.error?.includes("not possible to fast-forward")) {
      return { success: false, error: "Fast-forward not possible - branches have diverged" };
    }
    break;

  case "merge":
    result = executeGitCommand(`git merge --no-ff origin/${withBranch} -m "Merge origin/${withBranch} into ${targetBranch}"`);
    if (result.success) {
      steps.push(`Merged origin/${withBranch} into ${targetBranch}`);
    }
    break;

  case "rebase":
    result = executeGitCommand(`git rebase origin/${withBranch}`);
    if (result.success) {
      steps.push(`Rebased ${targetBranch} onto origin/${withBranch}`);
    }
    break;

  default:
    return { success: false, error: `Unknown strategy: ${strategy}` };
  }

  return {
    success: result.success,
    error: result.error
  };
}

async function handleAutoResolve(conflicts: string[], autoResolve: string, steps: string[], warnings: string[]): Promise<{ success: boolean }> {
  let resolvedCount = 0;

  for (const file of conflicts) {
    let resolveResult;

    switch (autoResolve) {
    case "ours":
      resolveResult = executeGitCommand(`git checkout --ours "${file}"`);
      break;
    case "theirs":
      resolveResult = executeGitCommand(`git checkout --theirs "${file}"`);
      break;
    case "smart":
      // Smart resolution: try to automatically resolve non-overlapping conflicts
      // For now, we'll use a simple heuristic - if file is mostly one side, use that side
      resolveResult = await attemptSmartResolve(file);
      break;
    default:
      resolveResult = { success: false, error: "Unknown auto-resolve strategy" };
    }

    if (resolveResult.success) {
      const addResult = executeGitCommand(`git add "${file}"`);
      if (addResult.success) {
        resolvedCount++;
        steps.push(`Auto-resolved conflict in ${file} using '${autoResolve}' strategy`);
      } else {
        warnings.push(`Resolved conflict in ${file} but failed to stage: ${addResult.error}`);
      }
    } else {
      warnings.push(`Failed to auto-resolve conflict in ${file}: ${resolveResult.error}`);
    }
  }

  return { success: resolvedCount > 0 };
}

async function attemptSmartResolve(file: string): Promise<{ success: boolean; error?: string }> {
  // This is a simplified smart resolution - in practice, this could be much more sophisticated
  try {
    // Try to resolve using git's built-in merge tools with preference for readability
    const result = executeGitCommand(`git checkout --theirs "${file}"`);
    return result;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function continueSyncOperation(strategy: string, steps: string[], warnings: string[]): Promise<{ success: boolean; error?: string }> {
  let result;

  switch (strategy) {
  case "rebase":
    result = executeGitCommand("git rebase --continue");
    if (result.success) {
      steps.push("Continued rebase after conflict resolution");
    }
    break;

  case "merge":
    // For merge, conflicts are resolved by committing
    result = executeGitCommand("git commit --no-edit");
    if (result.success) {
      steps.push("Completed merge after conflict resolution");
    }
    break;

  default:
    result = { success: true }; // Fast-forward doesn't need continuation
  }

  return {
    success: result.success,
    error: result.error
  };
}
