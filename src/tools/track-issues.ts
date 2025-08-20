import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";
import { execSync } from "child_process";

// Define the schema for tool parameters
export const schema = {
  action: z.enum(["fetch", "transition", "comment", "link", "create"]).describe("Action to perform on the issue"),
  issueKey: z.string().optional().describe("Issue key (JIRA-1234) or GitHub issue number"),
  branchName: z.string().optional().describe("Git branch to link with issue"),
  comment: z.string().optional().describe("Comment to add to the issue"),
  transition: z.string().optional().describe("Transition to apply (e.g., 'In Progress', 'Done')"),
  title: z.string().optional().describe("Issue title (for create action)"),
  description: z.string().optional().describe("Issue description (for create action)"),
  issueType: z.string().optional().describe("Issue type (Story, Bug, Task)"),
  assignee: z.string().optional().describe("User to assign the issue to"),
  labels: z.array(z.string()).optional().describe("Labels to apply to the issue"),
  autoDetect: z.boolean().optional().describe("Auto-detect issue from branch name")
};

// Define tool metadata
export const metadata: ToolMetadata = {
  name: "track_issues",
  description: "Integrate with JIRA, GitHub Issues, and other issue tracking systems to connect git workflows with project management",
  annotations: {
    title: "Track Issues",
    readOnlyHint: false,
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

// Helper function to detect issue from branch name
function detectIssueFromBranch(branchName?: string): string | null {
  const branch = branchName || getCurrentBranch();
  if (!branch) {return null;}

  // Common patterns: JIRA-123, feature/JIRA-123, #123, issue-123
  const jiraPattern = /([A-Z]+-\d+)/;
  const githubPattern = /#(\d+)/;
  const issuePattern = /issue[_-](\d+)/i;

  const jiraMatch = branch.match(jiraPattern);
  if (jiraMatch) {return jiraMatch[1];}

  const githubMatch = branch.match(githubPattern);
  if (githubMatch) {return githubMatch[1];}

  const issueMatch = branch.match(issuePattern);
  if (issueMatch) {return issueMatch[1];}

  return null;
}

// Helper function to detect platform
function detectIssuePlatform(): "jira" | "github" | "gitlab" | "unknown" {
  // Check for JIRA CLI
  if (isCommandAvailable("jira")) {
    return "jira";
  }

  // Check git remote for GitHub/GitLab
  const remoteResult = executeCommand("git remote get-url origin");
  if (remoteResult.success) {
    const url = remoteResult.stdout.toLowerCase();
    if (url.includes("github.com") && isCommandAvailable("gh")) {
      return "github";
    } else if (url.includes("gitlab.com") && isCommandAvailable("glab")) {
      return "gitlab";
    }
  }

  return "unknown";
}

// Helper function to check command availability
function isCommandAvailable(command: string): boolean {
  const result = executeCommand(`which ${command}`);
  return result.success;
}

// Tool implementation
export default async function trackIssues({
  action,
  issueKey,
  branchName,
  comment,
  transition,
  title,
  description,
  issueType = "Task",
  assignee,
  labels = [],
  autoDetect = true
}: InferSchema<typeof schema>) {
  const steps: string[] = [];
  const warnings: string[] = [];

  try {
    // Auto-detect issue from branch if requested
    let actualIssueKey = issueKey;
    if (autoDetect && !actualIssueKey) {
      actualIssueKey = detectIssueFromBranch(branchName);
      if (actualIssueKey) {
        steps.push(`Auto-detected issue: ${actualIssueKey}`);
      }
    }

    // Detect platform
    const platform = detectIssuePlatform();
    if (platform === "unknown" && action !== "link") {
      throw new Error("Unable to detect issue tracking platform. Install jira, gh, or glab CLI");
    }

    steps.push(`Platform: ${platform}`);

    // Execute action-specific logic
    switch (action) {
    case "fetch":
      return await handleFetchAction(platform, actualIssueKey, steps, warnings);

    case "transition":
      return await handleTransitionAction(platform, actualIssueKey, transition, steps, warnings);

    case "comment":
      return await handleCommentAction(platform, actualIssueKey, comment, steps, warnings);

    case "link":
      return await handleLinkAction(actualIssueKey, branchName, steps, warnings);

    case "create":
      return await handleCreateAction(platform, title, description, issueType, assignee, labels, steps, warnings);

    default:
      throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Failed to ${action} issue: ${error.message}\n\n` +
                `**Steps completed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  }
}

async function handleFetchAction(
  platform: string,
  issueKey?: string,
  steps: string[],
  warnings: string[]
) {
  if (!issueKey) {
    throw new Error("Issue key is required for fetch action");
  }

  let fetchCommand: string;
  switch (platform) {
  case "jira":
    fetchCommand = `jira issue view ${issueKey}`;
    break;
  case "github":
    fetchCommand = `gh issue view ${issueKey}`;
    break;
  case "gitlab":
    fetchCommand = `glab issue view ${issueKey}`;
    break;
  default:
    throw new Error(`Unsupported platform for fetch: ${platform}`);
  }

  const result = executeCommand(fetchCommand);
  if (result.success) {
    steps.push(`Fetched issue details for ${issueKey}`);

    // Parse the output for key information
    const output = result.stdout;
    let summary = "Issue details fetched successfully";

    // Extract title/summary if available
    const titleMatch = output.match(/title:\s*(.+)/i) || output.match(/summary:\s*(.+)/i);
    if (titleMatch) {
      summary = `${issueKey}: ${titleMatch[1]}`;
    }

    return {
      content: [
        {
          type: "text",
          text: `✅ ${summary}\n\n` +
                `**Issue Details:**\n\`\`\`\n${output}\n\`\`\`\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to fetch issue: ${result.error}`);
  }
}

async function handleTransitionAction(
  platform: string,
  issueKey?: string,
  transition?: string,
  steps: string[],
  warnings: string[]
) {
  if (!issueKey) {
    throw new Error("Issue key is required for transition action");
  }

  if (!transition) {
    throw new Error("Transition is required for transition action");
  }

  let transitionCommand: string;
  switch (platform) {
  case "jira":
    transitionCommand = `jira issue move ${issueKey} "${transition}"`;
    break;
  case "github":
    // GitHub doesn't have transitions, but we can close/reopen
    if (transition.toLowerCase() === "done" || transition.toLowerCase() === "closed") {
      transitionCommand = `gh issue close ${issueKey}`;
    } else if (transition.toLowerCase() === "open") {
      transitionCommand = `gh issue reopen ${issueKey}`;
    } else {
      warnings.push(`GitHub doesn't support transition "${transition}". Only close/reopen available.`);
      return {
        content: [
          {
            type: "text",
            text: `⚠️ Cannot transition issue ${issueKey} to "${transition}"\n\n` +
                  "GitHub only supports close/reopen transitions.\n\n" +
                  `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
          }
        ],
      };
    }
    break;
  default:
    throw new Error(`Unsupported platform for transition: ${platform}`);
  }

  const result = executeCommand(transitionCommand);
  if (result.success) {
    steps.push(`Transitioned ${issueKey} to "${transition}"`);

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully transitioned issue ${issueKey} to "${transition}"\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to transition issue: ${result.error}`);
  }
}

async function handleCommentAction(
  platform: string,
  issueKey?: string,
  comment?: string,
  steps: string[],
  warnings: string[]
) {
  if (!issueKey) {
    throw new Error("Issue key is required for comment action");
  }

  if (!comment) {
    throw new Error("Comment is required for comment action");
  }

  let commentCommand: string;
  switch (platform) {
  case "jira":
    commentCommand = `jira issue comment add ${issueKey} -m "${comment}"`;
    break;
  case "github":
    commentCommand = `gh issue comment ${issueKey} --body "${comment}"`;
    break;
  case "gitlab":
    commentCommand = `glab issue note ${issueKey} --message "${comment}"`;
    break;
  default:
    throw new Error(`Unsupported platform for comment: ${platform}`);
  }

  const result = executeCommand(commentCommand);
  if (result.success) {
    steps.push(`Added comment to ${issueKey}`);

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully added comment to issue ${issueKey}\n\n` +
                `**Comment:** ${comment}\n\n` +
                `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to add comment: ${result.error}`);
  }
}

async function handleLinkAction(
  issueKey?: string,
  branchName?: string,
  steps: string[],
  warnings: string[]
) {
  const branch = branchName || getCurrentBranch();
  if (!branch) {
    throw new Error("Cannot determine branch to link");
  }

  const issue = issueKey || detectIssueFromBranch(branch);
  if (!issue) {
    throw new Error("Cannot determine issue to link. Provide issueKey or use a branch with issue reference");
  }

  // Add to git notes for future reference
  const noteResult = executeCommand(`git notes add -m "Linked to issue: ${issue}"`);
  if (noteResult.success) {
    steps.push(`Linked branch ${branch} to issue ${issue} via git notes`);
  } else {
    warnings.push(`Failed to add git note: ${noteResult.error}`);
  }

  steps.push(`Created local link between branch ${branch} and issue ${issue}`);

  return {
    content: [
      {
        type: "text",
        text: `✅ Successfully linked branch "${branch}" to issue "${issue}"\n\n` +
              `**Branch:** ${branch}\n` +
              `**Issue:** ${issue}\n\n` +
              `**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}` +
              (warnings.length > 0 ? `\n\n**Warnings:**\n${warnings.map(w => `⚠️ ${w}`).join("\n")}` : "")
      }
    ],
  };
}

async function handleCreateAction(
  platform: string,
  title?: string,
  description?: string,
  issueType: string = "Task",
  assignee?: string,
  labels: string[] = [],
  steps: string[],
  warnings: string[]
) {
  if (!title) {
    throw new Error("Title is required for create action");
  }

  let createCommand: string;
  switch (platform) {
  case "jira":
    createCommand = `jira issue create -t "${issueType}" -s "${title}"`;
    if (description) {
      createCommand += ` -b "${description}"`;
    }
    if (assignee) {
      createCommand += ` -a "${assignee}"`;
    }
    break;
  case "github":
    createCommand = `gh issue create --title "${title}"`;
    if (description) {
      createCommand += ` --body "${description}"`;
    }
    if (assignee) {
      createCommand += ` --assignee "${assignee}"`;
    }
    if (labels.length > 0) {
      createCommand += ` --label ${labels.join(",")}`;
    }
    break;
  case "gitlab":
    createCommand = `glab issue create --title "${title}"`;
    if (description) {
      createCommand += ` --description "${description}"`;
    }
    if (assignee) {
      createCommand += ` --assignee "${assignee}"`;
    }
    if (labels.length > 0) {
      createCommand += ` --label ${labels.join(",")}`;
    }
    break;
  default:
    throw new Error(`Unsupported platform for create: ${platform}`);
  }

  const result = executeCommand(createCommand);
  if (result.success) {
    steps.push(`Created new ${issueType.toLowerCase()}: ${title}`);

    // Extract issue key/number from output
    let issueRef = "N/A";
    const keyMatch = result.stdout.match(/([A-Z]+-\d+)|#(\d+)/);
    if (keyMatch) {
      issueRef = keyMatch[0];
    }

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully created ${issueType.toLowerCase()}: "${title}"\n\n` +
                `**Issue:** ${issueRef}\n` +
                `**Type:** ${issueType}\n` +
                (assignee ? `**Assignee:** ${assignee}\n` : "") +
                (labels.length > 0 ? `**Labels:** ${labels.join(", ")}\n` : "") +
                `\n**Steps performed:**\n${steps.map(step => `• ${step}`).join("\n")}`
        }
      ],
    };
  } else {
    throw new Error(`Failed to create issue: ${result.error}`);
  }
}
