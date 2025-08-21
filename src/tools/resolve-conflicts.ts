import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

// Define the schema for tool parameters
export const schema = {
  action: z.enum(["analyze", "auto-resolve", "manual-assist", "abort", "status"]).describe("Conflict resolution action"),
  strategy: z.enum(["ours", "theirs", "smart", "interactive"]).optional().describe("Resolution strategy"),
  files: z.array(z.string()).optional().describe("Specific files to resolve (all conflicted files if not specified)"),
  backupChanges: z.boolean().optional().describe("Create backup of changes before resolution"),
  continueOperation: z.boolean().optional().describe("Continue merge/rebase operation after resolution"),
  previewOnly: z.boolean().optional().describe("Preview changes without applying them")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "resolve_conflicts",
  description: "Advanced conflict resolution with intelligent merge strategies and automated resolution patterns",
  annotations: {
    title: "Resolve Conflicts",
    readOnlyHint: false,
    destructiveHint: true,
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

// Helper function to check if we're in a merge/rebase state
function getConflictState(): { inMerge: boolean; inRebase: boolean; inCherryPick: boolean } {
  const mergeHead = executeCommand("test -f .git/MERGE_HEAD").success;
  const rebaseApply = executeCommand("test -d .git/rebase-apply").success;
  const rebaseMerge = executeCommand("test -d .git/rebase-merge").success;
  const cherryPickHead = executeCommand("test -f .git/CHERRY_PICK_HEAD").success;

  return {
    inMerge: mergeHead,
    inRebase: rebaseApply || rebaseMerge,
    inCherryPick: cherryPickHead
  };
}

// Helper function to get conflicted files
function getConflictedFiles(): string[] {
  const result = executeCommand("git diff --name-only --diff-filter=U");
  return result.success && result.stdout.trim()
    ? result.stdout.split("\n").filter(f => f.trim())
    : [];
}

// Helper function to analyze conflict markers in a file
function analyzeFileConflicts(filePath: string): {
  conflictBlocks: Array<{
    start: number;
    end: number;
    oursContent: string;
    theirsContent: string;
  }>;
  totalConflicts: number;
} {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const conflicts: Array<{
      start: number;
      end: number;
      oursContent: string;
      theirsContent: string;
    }> = [];

    let i = 0;
    while (i < lines.length) {
      if (lines[i].startsWith("<<<<<<<")) {
        const start = i;
        let middle = -1;
        let end = -1;

        // Find the middle (=======) and end (>>>>>>>) markers
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith("=======") && middle === -1) {
            middle = j;
          } else if (lines[j].startsWith(">>>>>>>")) {
            end = j;
            break;
          }
        }

        if (middle !== -1 && end !== -1) {
          const oursContent = lines.slice(start + 1, middle).join("\n");
          const theirsContent = lines.slice(middle + 1, end).join("\n");

          conflicts.push({
            start,
            end,
            oursContent,
            theirsContent
          });

          i = end + 1;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return {
      conflictBlocks: conflicts,
      totalConflicts: conflicts.length
    };
  } catch (error) {
    return { conflictBlocks: [], totalConflicts: 0 };
  }
}

// Helper function to apply smart resolution
function applySmartResolution(filePath: string, conflicts: Array<{
  start: number;
  end: number;
  oursContent: string;
  theirsContent: string;
}>): { resolved: number; strategy: string[] } {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    let resolvedCount = 0;
    const strategies: string[] = [];

    // Process conflicts in reverse order to maintain line numbers
    for (let i = conflicts.length - 1; i >= 0; i--) {
      const conflict = conflicts[i];
      const { start, end, oursContent, theirsContent } = conflict;

      let resolution = "";
      let strategy = "";

      // Strategy 1: Check if one side is empty
      if (!oursContent.trim() && theirsContent.trim()) {
        resolution = theirsContent;
        strategy = "theirs (ours empty)";
      } else if (oursContent.trim() && !theirsContent.trim()) {
        resolution = oursContent;
        strategy = "ours (theirs empty)";
      }
      // Strategy 2: Check if one side is a subset of the other
      else if (oursContent.includes(theirsContent)) {
        resolution = oursContent;
        strategy = "ours (includes theirs)";
      } else if (theirsContent.includes(oursContent)) {
        resolution = theirsContent;
        strategy = "theirs (includes ours)";
      }
      // Strategy 3: Check for import/require statements (merge both)
      else if (isImportBlock(oursContent, theirsContent)) {
        resolution = mergeImports(oursContent, theirsContent);
        strategy = "merged imports";
      }
      // Strategy 4: Check for simple additions (combine both)
      else if (isSimpleAddition(oursContent, theirsContent)) {
        resolution = `${oursContent}\n${theirsContent}`;
        strategy = "combined additions";
      }
      // Strategy 5: Choose theirs for version bumps
      else if (isVersionConflict(oursContent, theirsContent)) {
        resolution = theirsContent;
        strategy = "theirs (version update)";
      }

      if (resolution !== "") {
        // Replace the conflict block with the resolution
        lines.splice(start, end - start + 1, resolution);

        resolvedCount++;
        strategies.push(`Line ${start + 1}: ${strategy}`);
      }
    }

    if (resolvedCount > 0) {
      writeFileSync(filePath, lines.join("\n"));
    }

    return { resolved: resolvedCount, strategy: strategies };
  } catch (error) {
    return { resolved: 0, strategy: [`Error processing ${filePath}: ${error}`] };
  }
}

// Helper functions for smart resolution heuristics
function isImportBlock(ours: string, theirs: string): boolean {
  const importPattern = /^(import|require|from|#include)/m;
  return importPattern.test(ours) && importPattern.test(theirs);
}

function mergeImports(ours: string, theirs: string): string {
  const oursLines = ours.split("\n").filter(l => l.trim());
  const theirsLines = theirs.split("\n").filter(l => l.trim());

  // Combine and deduplicate imports
  const allImports = [...oursLines, ...theirsLines];
  const uniqueImports = [...new Set(allImports)];

  return uniqueImports.sort().join("\n");
}

function isSimpleAddition(ours: string, theirs: string): boolean {
  // Check if both sides are adding new lines without removing anything
  const oursLines = ours.trim().split("\n");
  const theirsLines = theirs.trim().split("\n");

  return oursLines.length <= 5 && theirsLines.length <= 5 &&
         !ours.includes("delete") && !theirs.includes("delete") &&
         !ours.includes("-") && !theirs.includes("-");
}

function isVersionConflict(ours: string, theirs: string): boolean {
  const versionPattern = /version|VERSION|"v?\d+\.\d+\.\d+"/;
  return versionPattern.test(ours) && versionPattern.test(theirs);
}

// Tool implementation
export default async function resolveConflicts({
  action,
  strategy = "smart",
  files = [],
  backupChanges = true,
  continueOperation = true,
  previewOnly = false
}: InferSchema<typeof schema>) {
  const steps: string[] = [];
  const warnings: string[] = [];

  try {
    // Verify we're in a git repository
    const gitCheckResult = executeCommand("git rev-parse --git-dir");
    if (!gitCheckResult.success) {
      throw new Error("Not in a git repository");
    }

    // Execute action-specific logic
    switch (action) {
    case "status":
      return await handleStatus(steps, warnings);

    case "analyze":
      return await handleAnalyze(files, steps, warnings);

    case "auto-resolve":
      return await handleAutoResolve(strategy, files, backupChanges, continueOperation, previewOnly, steps, warnings);

    case "manual-assist":
      return await handleManualAssist(files, steps, warnings);

    case "abort":
      return await handleAbort(steps, warnings);

    default:
      throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to ${action} conflicts: ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }
}

async function handleStatus(steps: string[], warnings: string[]) {
  const state = getConflictState();
  const conflictedFiles = getConflictedFiles();

  steps.push("Analyzed current conflict state");

  let statusText = "🔍 **Conflict Status**\n\n";

  if (state.inMerge) {
    statusText += "📍 **State:** Currently in merge operation\n";
  } else if (state.inRebase) {
    statusText += "📍 **State:** Currently in rebase operation\n";
  } else if (state.inCherryPick) {
    statusText += "📍 **State:** Currently in cherry-pick operation\n";
  } else {
    statusText += "📍 **State:** No active merge/rebase operation\n";
  }

  if (conflictedFiles.length > 0) {
    statusText += `**Conflicted files:** ${conflictedFiles.length}\n\n`;

    for (const file of conflictedFiles) {
      const analysis = analyzeFileConflicts(file);
      statusText += `• **${file}**: ${analysis.totalConflicts} conflict blocks\n`;
    }
  } else {
    statusText += "✅ **No conflicts found**\n";
  }

  return {
    content: [
      {
        type: "text",
        text: statusText + `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
      }
    ],
  };
}

async function handleAnalyze(
  targetFiles: string[],
  steps: string[],
  warnings: string[]
) {
  const conflictedFiles = targetFiles.length > 0 ? targetFiles : getConflictedFiles();

  if (conflictedFiles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "✅ No conflicted files found to analyze"
        }
      ],
    };
  }

  steps.push(`Analyzing ${conflictedFiles.length} conflicted files`);

  let analysisText = "🔍 **Conflict Analysis**\n\n";
  let totalConflicts = 0;

  for (const file of conflictedFiles) {
    const analysis = analyzeFileConflicts(file);
    totalConflicts += analysis.totalConflicts;

    analysisText += `**${file}**\n`;
    analysisText += `• Conflict blocks: ${analysis.totalConflicts}\n`;

    if (analysis.conflictBlocks.length > 0) {
      for (const conflict of analysis.conflictBlocks.slice(0, 3)) { // Show first 3 conflicts
        analysisText += `  - Lines ${conflict.start + 1}-${conflict.end + 1}: `;

        if (!conflict.oursContent.trim()) {
          analysisText += "Ours empty, theirs has content\n";
        } else if (!conflict.theirsContent.trim()) {
          analysisText += "Theirs empty, ours has content\n";
        } else if (conflict.oursContent.includes(conflict.theirsContent)) {
          analysisText += "Ours includes theirs\n";
        } else if (conflict.theirsContent.includes(conflict.oursContent)) {
          analysisText += "Theirs includes ours\n";
        } else if (isImportBlock(conflict.oursContent, conflict.theirsContent)) {
          analysisText += "Import/require statements - can merge\n";
        } else {
          analysisText += "Complex conflict - manual resolution needed\n";
        }
      }

      if (analysis.conflictBlocks.length > 3) {
        analysisText += `  ... and ${analysis.conflictBlocks.length - 3} more conflicts\n`;
      }
    }
    analysisText += "\n";
  }

  analysisText += `**Summary:** ${totalConflicts} total conflicts in ${conflictedFiles.length} files\n`;

  steps.push(`Found ${totalConflicts} conflicts across ${conflictedFiles.length} files`);

  return {
    content: [
      {
        type: "text",
        text: analysisText + `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
      }
    ],
  };
}

async function handleAutoResolve(
  strategy: string,
  targetFiles: string[],
  backupChanges: boolean,
  continueOperation: boolean,
  previewOnly: boolean,
  steps: string[],
  warnings: string[]
) {
  const conflictedFiles = targetFiles.length > 0 ? targetFiles : getConflictedFiles();

  if (conflictedFiles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "✅ No conflicted files found to resolve"
        }
      ],
    };
  }

  steps.push(`Auto-resolving ${conflictedFiles.length} files using '${strategy}' strategy`);

  if (previewOnly) {
    steps.push("🔍 PREVIEW MODE - No changes will be made");
  }

  // Create backup if requested
  if (backupChanges && !previewOnly) {
    const backupResult = executeCommand("git stash push -m 'Backup before conflict resolution'");
    if (backupResult.success) {
      steps.push("Created backup of current changes");
    } else {
      warnings.push("Failed to create backup");
    }
  }

  let totalResolved = 0;
  const resolutionDetails: string[] = [];

  for (const file of conflictedFiles) {
    let resolveResult: { resolved: number; strategy: string[] };

    switch (strategy) {
    case "ours":
      if (!previewOnly) {
        const result = executeCommand(`git checkout --ours "${file}"`);
        resolveResult = result.success
          ? { resolved: 1, strategy: ["Chose ours for entire file"] }
          : { resolved: 0, strategy: [`Failed: ${result.error}`] };
      } else {
        resolveResult = { resolved: 1, strategy: ["Would choose ours for entire file"] };
      }
      break;

    case "theirs":
      if (!previewOnly) {
        const result = executeCommand(`git checkout --theirs "${file}"`);
        resolveResult = result.success
          ? { resolved: 1, strategy: ["Chose theirs for entire file"] }
          : { resolved: 0, strategy: [`Failed: ${result.error}`] };
      } else {
        resolveResult = { resolved: 1, strategy: ["Would choose theirs for entire file"] };
      }
      break;

    case "smart":
      const analysis = analyzeFileConflicts(file);
      if (!previewOnly) {
        resolveResult = applySmartResolution(file, analysis.conflictBlocks);
      } else {
        // Preview what would be resolved
        const strategies = [];
        for (const conflict of analysis.conflictBlocks) {
          if (!conflict.oursContent.trim() && conflict.theirsContent.trim()) {
            strategies.push("Would choose theirs (ours empty)");
          } else if (conflict.oursContent.trim() && !conflict.theirsContent.trim()) {
            strategies.push("Would choose ours (theirs empty)");
          } else if (isImportBlock(conflict.oursContent, conflict.theirsContent)) {
            strategies.push("Would merge imports");
          } else {
            strategies.push("Would require manual resolution");
          }
        }
        resolveResult = { resolved: strategies.length, strategy: strategies };
      }
      break;

    default:
      resolveResult = { resolved: 0, strategy: [`Unknown strategy: ${strategy}`] };
    }

    if (resolveResult.resolved > 0) {
      totalResolved++;

      if (!previewOnly) {
        // Stage the resolved file
        const stageResult = executeCommand(`git add "${file}"`);
        if (stageResult.success) {
          steps.push(`✅ Resolved and staged ${file}`);
        } else {
          warnings.push(`Resolved ${file} but failed to stage: ${stageResult.error}`);
        }
      } else {
        steps.push(`📋 Would resolve ${file}`);
      }

      resolutionDetails.push(`**${file}:**\n${resolveResult.strategy.map(s => `  • ${s}`).join("\n")}`);
    } else {
      warnings.push(`Failed to resolve ${file}: ${resolveResult.strategy.join(", ")}`);
    }
  }

  // Continue operation if requested and all conflicts resolved
  if (continueOperation && totalResolved === conflictedFiles.length && !previewOnly) {
    const state = getConflictState();

    if (state.inRebase) {
      const continueResult = executeCommand("git rebase --continue");
      if (continueResult.success) {
        steps.push("✅ Continued rebase operation");
      } else {
        warnings.push(`Failed to continue rebase: ${continueResult.error}`);
      }
    } else if (state.inMerge) {
      const commitResult = executeCommand("git commit --no-edit");
      if (commitResult.success) {
        steps.push("✅ Completed merge operation");
      } else {
        warnings.push(`Failed to complete merge: ${commitResult.error}`);
      }
    } else if (state.inCherryPick) {
      const continueResult = executeCommand("git cherry-pick --continue");
      if (continueResult.success) {
        steps.push("✅ Continued cherry-pick operation");
      } else {
        warnings.push(`Failed to continue cherry-pick: ${continueResult.error}`);
      }
    }
  }

  let resultText = `${previewOnly ? "🔍 PREVIEW:" : "✅"} Auto-resolved ${totalResolved} of ${conflictedFiles.length} files using '${strategy}' strategy\n\n`;

  if (resolutionDetails.length > 0) {
    resultText += "**Resolution Details:**\n" + resolutionDetails.join("\n\n") + "\n\n";
  }

  return {
    content: [
      {
        type: "text",
        text: resultText +
              `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
      }
    ],
  };
}

async function handleManualAssist(
  targetFiles: string[],
  steps: string[],
  warnings: string[]
) {
  const conflictedFiles = targetFiles.length > 0 ? targetFiles : getConflictedFiles();

  if (conflictedFiles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "✅ No conflicted files found"
        }
      ],
    };
  }

  steps.push(`Providing manual resolution assistance for ${conflictedFiles.length} files`);

  let assistText = "🛠️ **Manual Resolution Assistance**\n\n";

  for (const file of conflictedFiles) {
    const analysis = analyzeFileConflicts(file);

    assistText += `**${file}** (${analysis.totalConflicts} conflicts)\n`;
    assistText += "```bash\n";
    assistText += "# Edit the file to resolve conflicts:\n";
    assistText += `vim ${file}  # or your preferred editor\n\n`;
    assistText += "# When resolved, stage the file:\n";
    assistText += `git add ${file}\n`;
    assistText += "```\n\n";

    if (analysis.conflictBlocks.length > 0) {
      assistText += "**Conflict locations:**\n";
      for (const conflict of analysis.conflictBlocks.slice(0, 3)) {
        assistText += `• Lines ${conflict.start + 1}-${conflict.end + 1}\n`;

        // Provide suggestions
        if (!conflict.oursContent.trim()) {
          assistText += "  💡 Suggestion: Keep theirs (ours is empty)\n";
        } else if (!conflict.theirsContent.trim()) {
          assistText += "  💡 Suggestion: Keep ours (theirs is empty)\n";
        } else if (isImportBlock(conflict.oursContent, conflict.theirsContent)) {
          assistText += "  💡 Suggestion: Merge import statements\n";
        } else {
          assistText += "  💡 Suggestion: Review both versions carefully\n";
        }
      }

      if (analysis.conflictBlocks.length > 3) {
        assistText += `  ... and ${analysis.conflictBlocks.length - 3} more conflicts\n`;
      }
    }

    assistText += "\n";
  }

  const state = getConflictState();
  assistText += "**After resolving all conflicts:**\n";

  if (state.inRebase) {
    assistText += "```bash\ngit rebase --continue\n```\n";
  } else if (state.inMerge) {
    assistText += "```bash\ngit commit\n```\n";
  } else if (state.inCherryPick) {
    assistText += "```bash\ngit cherry-pick --continue\n```\n";
  }

  return {
    content: [
      {
        type: "text",
        text: assistText + `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
      }
    ],
  };
}

async function handleAbort(steps: string[], warnings: string[]) {
  const state = getConflictState();

  if (!state.inMerge && !state.inRebase && !state.inCherryPick) {
    return {
      content: [
        {
          type: "text",
          text: "ℹ️ No active merge/rebase/cherry-pick operation to abort"
        }
      ],
    };
  }

  steps.push("Aborting current operation");

  let abortCommand = "";
  if (state.inRebase) {
    abortCommand = "git rebase --abort";
  } else if (state.inMerge) {
    abortCommand = "git merge --abort";
  } else if (state.inCherryPick) {
    abortCommand = "git cherry-pick --abort";
  }

  if (abortCommand) {
    const result = executeCommand(abortCommand);
    if (result.success) {
      steps.push("✅ Successfully aborted operation");

      return {
        content: [
          {
            type: "text",
            text: "✅ **Operation Aborted**\n\n" +
                  "Repository has been restored to the state before the operation.\n\n" +
                  `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
          }
        ],
      };
    } else {
      throw new Error(`Failed to abort operation: ${result.error}`);
    }
  }

  throw new Error("Could not determine appropriate abort command");
}
