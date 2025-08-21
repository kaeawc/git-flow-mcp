import { expect } from "chai";
import { stub, restore } from "sinon";
import { execSync } from "child_process";
import orchestrateWorkflow, { schema, metadata } from "../../src/tools/orchestrate-workflow";

describe("orchestrate-workflow tool", () => {
  let execSyncStub: any;

  beforeEach(() => {
    execSyncStub = stub(require('child_process'), 'execSync');
  });

  afterEach(() => {
    restore();
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(metadata.name).to.equal("orchestrate_workflow");
      expect(metadata.description).to.equal("High-level workflow orchestration combining multiple git operations for common development patterns");
      expect(metadata.annotations.title).to.equal("Orchestrate Workflow");
      expect(metadata.annotations.readOnlyHint).to.be.false;
      expect(metadata.annotations.destructiveHint).to.be.false;
      expect(metadata.annotations.idempotentHint).to.be.false;
    });
  });

  describe("schema validation", () => {
    it("should have correct workflow enum values", () => {
      const workflowSchema = schema.workflow;
      expect(workflowSchema._def.typeName).to.equal("ZodEnum");
      expect(workflowSchema._def.values).to.deep.equal([
        "start-work",
        "complete-feature",
        "address-feedback",
        "hotfix",
        "release-prep",
        "cleanup"
      ]);
    });

    it("should have optional parameters with correct types", () => {
      expect(schema.ticket).to.exist;
      expect(schema.branchName).to.exist;
      expect(schema.targetBranch).to.exist;
      expect(schema.message).to.exist;
      expect(schema.autoMerge).to.exist;
      expect(schema.skipTests).to.exist;
      expect(schema.dryRun).to.exist;
      expect(schema.assignReviewers).to.exist;
      expect(schema.labels).to.exist;
    });
  });

  describe("error handling", () => {
    it("should handle non-git repository error", async () => {
      execSyncStub.throws(new Error("Not a git repository"));

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("❌ Failed to orchestrate start-work");
      expect(result.content[0].text).to.include("Not in a git repository");
    });

    it("should handle unknown workflow", async () => {
      // Mock git repository check to succeed
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");

      const result = await orchestrateWorkflow({
        workflow: "invalid-workflow" as any
      });

      expect(result.content[0].text).to.include("❌ Failed to orchestrate invalid-workflow");
    });
  });

  describe("start-work workflow", () => {
    beforeEach(() => {
      // Mock successful git repository check
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      // Mock remote URL detection
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
      // Mock current branch
      execSyncStub.withArgs("git branch --show-current").returns("main");
    });

    it("should handle start-work with ticket", async () => {
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      execSyncStub.withArgs("git checkout -b feature/jira-123").returns("");
      execSyncStub.withArgs("git push -u origin feature/jira-123").returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work",
        ticket: "JIRA-123",
        targetBranch: "main"
      });

      expect(result.content[0].text).to.include("✅ Successfully started work on JIRA-123");
      expect(result.content[0].text).to.include("**Working branch:** feature/jira-123");
      expect(result.content[0].text).to.include("**Base branch:** main");
      expect(result.content[0].text).to.include("**Ticket:** JIRA-123");
    });

    it("should handle start-work without ticket", async () => {
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      // Generate the same timestamp format the tool uses: YYYYMMDD
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const expectedBranch = `feature/work-${timestamp}`;
      execSyncStub.withArgs(`git checkout -b ${expectedBranch}`).returns("");
      execSyncStub.withArgs(`git push -u origin ${expectedBranch}`).returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("✅ Successfully started work");
      expect(result.content[0].text).to.include(`**Working branch:** ${expectedBranch}`);
    });

    it("should handle start-work in dry run mode", async () => {
      const result = await orchestrateWorkflow({
        workflow: "start-work",
        ticket: "JIRA-123",
        dryRun: true
      });

      expect(result.content[0].text).to.include("✅ Successfully started work on JIRA-123");
      expect(result.content[0].text).to.include("🔍 DRY RUN MODE");
    });

    it("should handle checkout failure", async () => {
      // Don't mock current branch check - let it use the default behavior
      // The checkout should fail before any branch creation attempts
      execSyncStub.withArgs("git checkout main").throws(new Error("Branch not found"));

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("❌ Failed to orchestrate start-work");
      expect(result.content[0].text).to.include("Failed to create branch");
    });

    it("should handle pull failure with warning", async () => {
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").throws(new Error("Network error"));
      execSyncStub.withArgs("git checkout -b feature/jira-123").returns("");
      execSyncStub.withArgs("git push -u origin feature/jira-123").returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work",
        ticket: "JIRA-123"
      });

      expect(result.content[0].text).to.include("✅ Successfully started work on JIRA-123");
      expect(result.content[0].text).to.include("⚠️ Failed to pull latest changes");
    });
  });

  describe("complete-feature workflow", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
      execSyncStub.withArgs("git branch --show-current").returns("feature/test-branch");
      execSyncStub.withArgs("git status --porcelain").returns("");
    });

    it("should complete feature workflow successfully", async () => {
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rebase origin/main").returns("");
      execSyncStub.withArgs("test -f package.json").returns("");
      execSyncStub.withArgs("npm test || pnpm test || yarn test").returns("Tests passed");
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");
      execSyncStub.withArgs(/gh pr create/).returns("PR created");

      const result = await orchestrateWorkflow({
        workflow: "complete-feature",
        message: "Complete feature implementation",
        assignReviewers: ["reviewer1"],
        labels: ["feature"]
      });

      expect(result.content[0].text).to.include("✅ Successfully completed feature workflow");
      expect(result.content[0].text).to.include("**Branch:** feature/test-branch");
      expect(result.content[0].text).to.include("**Reviewers:** reviewer1");
    });

    it("should handle unclean working directory", async () => {
      execSyncStub.withArgs("git status --porcelain").returns("M modified-file.txt");

      const result = await orchestrateWorkflow({
        workflow: "complete-feature"
      });

      expect(result.content[0].text).to.include("❌ Failed to orchestrate complete-feature");
      expect(result.content[0].text).to.include("Working directory is not clean");
    });

    it("should skip tests when requested", async () => {
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rebase origin/main").returns("");
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");

      const result = await orchestrateWorkflow({
        workflow: "complete-feature",
        skipTests: true
      });

      expect(result.content[0].text).to.include("⏭️ Skipped tests");
    });

    it("should handle test failure with warning", async () => {
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rebase origin/main").returns("");
      execSyncStub.withArgs("test -f package.json").returns("");
      execSyncStub.withArgs("npm test || pnpm test || yarn test").throws(new Error("Tests failed"));
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");

      const result = await orchestrateWorkflow({
        workflow: "complete-feature"
      });

      expect(result.content[0].text).to.include("✅ Successfully completed feature workflow");
      expect(result.content[0].text).to.include("⚠️ Tests failed - consider fixing before creating PR");
    });

    it("should handle GitLab platform", async () => {
      execSyncStub.withArgs("git remote get-url origin").returns("https://gitlab.com/user/repo.git");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rebase origin/main").returns("");
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");
      // Mock the exact GitLab command format
      execSyncStub.withArgs("glab mr create --title \"Complete: feature/test-branch\" --target-branch main --source-branch feature/test-branch").returns("MR created");

      const result = await orchestrateWorkflow({
        workflow: "complete-feature"
      });

      expect(result.content[0].text).to.include("✅ Successfully completed feature workflow");
      expect(result.content[0].text).to.include("Created MR:");
    });
  });

  describe("address-feedback workflow", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
      execSyncStub.withArgs("git branch --show-current").returns("feature/test-branch");
    });

    it("should address feedback successfully", async () => {
      execSyncStub.withArgs(`gh pr list --head feature/test-branch --json number --jq '.[0].number'`).returns("123");
      execSyncStub.withArgs("gh pr view 123 --json comments,reviews").returns("{}");
      execSyncStub.withArgs("git add .").returns("");
      execSyncStub.withArgs('git commit -m "Address code review feedback"').returns("");
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");
      execSyncStub.withArgs("gh pr comment 123 --body \"Addressed review feedback\"").returns("");

      const result = await orchestrateWorkflow({
        workflow: "address-feedback"
      });

      expect(result.content[0].text).to.include("✅ Successfully addressed feedback");
      expect(result.content[0].text).to.include("**Branch:** feature/test-branch");
      expect(result.content[0].text).to.include("**PR:** #123");
    });

    it("should handle custom commit message", async () => {
      execSyncStub.withArgs("git add .").returns("");
      execSyncStub.withArgs('git commit -m "Fix validation logic"').returns("");
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");

      const result = await orchestrateWorkflow({
        workflow: "address-feedback",
        message: "Fix validation logic"
      });

      expect(result.content[0].text).to.include("**Commit:** Fix validation logic");
    });

    it("should handle no PR found", async () => {
      execSyncStub.withArgs(`gh pr list --head feature/test-branch --json number --jq '.[0].number'`).returns("null");
      execSyncStub.withArgs("git add .").returns("");
      execSyncStub.withArgs('git commit -m "Address code review feedback"').returns("");
      execSyncStub.withArgs("git push origin feature/test-branch").returns("");

      const result = await orchestrateWorkflow({
        workflow: "address-feedback"
      });

      expect(result.content[0].text).to.include("✅ Successfully addressed feedback");
      expect(result.content[0].text).to.not.include("**PR:** #");
    });
  });

  describe("hotfix workflow", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
      // Don't mock status in beforeEach - let individual tests handle it
    });

    it("should create hotfix successfully", async () => {
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      execSyncStub.withArgs("git checkout -b feature/urgent-456").returns("");
      execSyncStub.withArgs("git push -u origin feature/urgent-456").returns("");
      execSyncStub.withArgs("git status --porcelain").returns(""); // Clean working directory
      execSyncStub.withArgs(/gh pr create.*--label hotfix/).returns("PR created");

      const result = await orchestrateWorkflow({
        workflow: "hotfix",
        ticket: "URGENT-456",
        message: "Fix critical bug"
      });

      expect(result.content[0].text).to.include("🚨 **HOTFIX WORKFLOW INITIATED**");
      expect(result.content[0].text).to.include("**Issue:** URGENT-456");
      expect(result.content[0].text).to.include("⚡ Next Steps:");
    });

    it("should handle hotfix with changes to commit", async () => {
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      // When a ticket is provided to hotfix, it creates feature/ticket-name branch
      execSyncStub.withArgs("git checkout -b feature/urgent-456").returns("");
      // Mock the status check to return changes (not clean working directory)
      execSyncStub.withArgs("git status --porcelain").returns("M critical-file.js");
      execSyncStub.withArgs("git add .").returns("");
      execSyncStub.withArgs('git commit -m "Hotfix: URGENT-456"').returns("");
      execSyncStub.withArgs("git push -u origin feature/urgent-456").returns("");

      const result = await orchestrateWorkflow({
        workflow: "hotfix",
        ticket: "URGENT-456"
      });

      expect(result.content[0].text).to.include("🚨 **HOTFIX WORKFLOW INITIATED**");
      expect(result.content[0].text).to.include("Committed hotfix: Hotfix: URGENT-456");
    });
  });

  describe("release-prep workflow", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
    });

    it("should prepare release successfully", async () => {
      execSyncStub.withArgs("git checkout develop || git checkout staging").returns("");
      execSyncStub.withArgs("git pull").returns("");
      execSyncStub.withArgs(/git checkout -b release\/v\d+/).returns("");
      execSyncStub.withArgs("test -f package.json").returns("");
      execSyncStub.withArgs(/git push -u origin release\/v\d+/).returns("");
      execSyncStub.withArgs(/gh pr create.*--label release/).returns("PR created");

      const result = await orchestrateWorkflow({
        workflow: "release-prep",
        message: "Release v1.0.0"
      });

      expect(result.content[0].text).to.include("🚀 **RELEASE PREPARATION COMPLETE**");
      expect(result.content[0].text).to.include("**Release branch:** release/v");
      expect(result.content[0].text).to.include("📋 Manual Tasks:");
    });

    it("should handle custom release branch name", async () => {
      execSyncStub.withArgs("git checkout develop || git checkout staging").returns("");
      execSyncStub.withArgs("git pull").returns("");
      execSyncStub.withArgs("git checkout -b release/v2.0.0").returns("");
      execSyncStub.withArgs("git push -u origin release/v2.0.0").returns("");

      const result = await orchestrateWorkflow({
        workflow: "release-prep",
        branchName: "release/v2.0.0"
      });

      expect(result.content[0].text).to.include("**Release branch:** release/v2.0.0");
    });
  });

  describe("cleanup workflow", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
    });

    it("should clean up merged branches", async () => {
      execSyncStub.withArgs("git fetch --prune").returns("");
      execSyncStub.withArgs("git branch --merged main").returns("  feature/old-1\n  feature/old-2\n  feature/old-3");
      execSyncStub.withArgs("git branch -d feature/old-1").returns("");
      execSyncStub.withArgs("git branch -d feature/old-2").returns("");
      execSyncStub.withArgs("git branch -d feature/old-3").returns("");
      execSyncStub.withArgs("git gc --prune=now").returns("");
      execSyncStub.withArgs("git status --short").returns("");

      const result = await orchestrateWorkflow({
        workflow: "cleanup"
      });

      expect(result.content[0].text).to.include("🧹 **CLEANUP COMPLETE**");
      expect(result.content[0].text).to.include("**Merged branches deleted:** 3");
      expect(result.content[0].text).to.include("✅ Repository is clean");
    });

    it("should handle no merged branches", async () => {
      execSyncStub.withArgs("git fetch --prune").returns("");
      execSyncStub.withArgs("git branch --merged main").returns("* main");
      execSyncStub.withArgs("git gc --prune=now").returns("");
      execSyncStub.withArgs("git status --short").returns("");

      const result = await orchestrateWorkflow({
        workflow: "cleanup"
      });

      expect(result.content[0].text).to.include("**Merged branches deleted:** 0");
    });

    it("should handle branch deletion failures", async () => {
      execSyncStub.withArgs("git fetch --prune").returns("");
      execSyncStub.withArgs("git branch --merged main").returns("  feature/old-1");
      execSyncStub.withArgs("git branch -d feature/old-1").throws(new Error("Branch has unmerged changes"));
      execSyncStub.withArgs("git gc --prune=now").returns("");
      execSyncStub.withArgs("git status --short").returns("");

      const result = await orchestrateWorkflow({
        workflow: "cleanup"
      });

      expect(result.content[0].text).to.include("⚠️ Failed to delete feature/old-1");
    });

    it("should limit branch cleanup to 5 branches", async () => {
      const manyBranches = Array.from({length: 8}, (_, i) => `  feature/old-${i + 1}`).join("\n");
      execSyncStub.withArgs("git fetch --prune").returns("");
      execSyncStub.withArgs("git branch --merged main").returns(manyBranches);
      
      // Only first 5 branches should be deleted
      for (let i = 1; i <= 5; i++) {
        execSyncStub.withArgs(`git branch -d feature/old-${i}`).returns("");
      }
      
      execSyncStub.withArgs("git gc --prune=now").returns("");
      execSyncStub.withArgs("git status --short").returns("");

      const result = await orchestrateWorkflow({
        workflow: "cleanup"
      });

      expect(result.content[0].text).to.include("... and 3 more branches (run again to continue cleanup)");
    });
  });

  describe("platform detection", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
    });

    it("should detect GitHub platform", async () => {
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      execSyncStub.withArgs(/git checkout -b/).returns("");
      execSyncStub.withArgs(/git push -u origin/).returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("Platform: github");
    });

    it("should detect GitLab platform", async () => {
      execSyncStub.withArgs("git remote get-url origin").returns("https://gitlab.com/user/repo.git");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      execSyncStub.withArgs(/git checkout -b/).returns("");
      execSyncStub.withArgs(/git push -u origin/).returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("Platform: gitlab");
    });

    it("should handle unknown platform", async () => {
      execSyncStub.withArgs("git remote get-url origin").returns("https://example.com/user/repo.git");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      execSyncStub.withArgs(/git checkout -b/).returns("");
      execSyncStub.withArgs(/git push -u origin/).returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("Platform: unknown");
    });
  });

  describe("branch name generation", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
    });

    it("should generate branch name from JIRA ticket", async () => {
      execSyncStub.withArgs("git checkout -b feature/jira-123").returns("");
      execSyncStub.withArgs("git push -u origin feature/jira-123").returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work",
        ticket: "JIRA-123"
      });

      expect(result.content[0].text).to.include("**Working branch:** feature/jira-123");
    });

    it("should generate branch name from GitHub issue", async () => {
      execSyncStub.withArgs("git checkout -b feature/issue-456").returns("");
      execSyncStub.withArgs("git push -u origin feature/issue-456").returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work",
        ticket: "#456"
      });

      expect(result.content[0].text).to.include("**Working branch:** feature/issue-456");
    });

    it("should generate timestamp-based branch name", async () => {
      // Mock commands for auto-generated branch name workflow
      execSyncStub.withArgs("git checkout main").returns("");
      execSyncStub.withArgs("git pull origin main").returns("");
      // Generate the same timestamp format the tool uses: YYYYMMDD
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const expectedBranch = `feature/work-${timestamp}`;
      execSyncStub.withArgs(`git checkout -b ${expectedBranch}`).returns("");
      execSyncStub.withArgs(`git push -u origin ${expectedBranch}`).returns("");

      const result = await orchestrateWorkflow({
        workflow: "start-work"
      });

      expect(result.content[0].text).to.include("✅ Successfully started work");
      expect(result.content[0].text).to.include(`**Working branch:** ${expectedBranch}`);
    });
  });

  describe("dry run mode", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("/.git");
      execSyncStub.withArgs("git remote get-url origin").returns("https://github.com/user/repo.git");
    });

    it("should show dry run commands for all workflows", async () => {
      const workflows = ["start-work", "complete-feature", "address-feedback", "hotfix", "release-prep", "cleanup"];
      
      for (const workflow of workflows) {
        const result = await orchestrateWorkflow({
          workflow: workflow as any,
          dryRun: true
        });

        expect(result.content[0].text).to.include("🔍 DRY RUN MODE");
      }
    });
  });
});