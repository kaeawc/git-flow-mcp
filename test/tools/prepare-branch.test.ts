import { expect } from "chai";
import * as sinon from "sinon";
import prepareBranch, { schema, metadata } from "../../src/tools/prepare-branch";

describe("prepare-branch tool", () => {
  let execSyncStub: sinon.SinonStub;

  beforeEach(() => {
    execSyncStub = sinon.stub(require("child_process"), "execSync");
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(metadata.name).to.equal("prepare_branch");
      expect(metadata.description).to.equal("Create, checkout, or sync branches intelligently with automatic handling of common git operations");
      expect(metadata.annotations.title).to.equal("Prepare Branch");
      expect(metadata.annotations.readOnlyHint).to.be.false;
      expect(metadata.annotations.destructiveHint).to.be.false;
      expect(metadata.annotations.idempotentHint).to.be.false;
    });
  });

  describe("schema validation", () => {
    it("should have correct schema structure", () => {
      expect(schema.branch).to.exist;
      expect(schema.branch._def.typeName).to.equal("ZodString");
      expect(schema.base).to.exist;
      expect(schema.base._def.typeName).to.equal("ZodOptional");
      expect(schema.action).to.exist;
      expect(schema.action._def.typeName).to.equal("ZodEnum");
      expect(schema.syncStrategy).to.exist;
      expect(schema.syncStrategy._def.typeName).to.equal("ZodOptional");
      expect(schema.stashChanges).to.exist;
      expect(schema.stashChanges._def.typeName).to.equal("ZodOptional");
      expect(schema.pushToRemote).to.exist;
      expect(schema.pushToRemote._def.typeName).to.equal("ZodOptional");
    });

    it("should validate action enum values", () => {
      const actionValues = schema.action._def.values;
      expect(actionValues).to.include("create");
      expect(actionValues).to.include("checkout");
      expect(actionValues).to.include("sync");
    });

    it("should validate syncStrategy enum values", () => {
      const syncStrategyValues = schema.syncStrategy._def.innerType._def.values;
      expect(syncStrategyValues).to.include("rebase");
      expect(syncStrategyValues).to.include("merge");
    });
  });

  describe("error handling", () => {
    it("should handle not being in a git repository", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").throws(new Error("not a git repository"));

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create"
      });

      expect(result.content[0].text).to.include("❌ Failed to create branch");
      expect(result.content[0].text).to.include("Not in a git repository");
    });

    it("should fail when git command fails and causes overall operation to fail", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").throws(new Error("fetch failed"));
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").throws(new Error("some critical git command failed"));

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create"
      });

      // The operation should fail due to the git checkout -b command failure
      expect(result.content[0].text).to.include("❌ Failed to create branch");
    });

    it("should fail when branch creation fails", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");

      // This should cause the operation to fail during branch creation
      execSyncStub.withArgs("git checkout -b feature-branch").throws(new Error("branch creation failed"));

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create"
      });

      // This should fail the entire operation, not just add a warning
      expect(result.content[0].text).to.include("❌ Failed to create branch");
      expect(result.content[0].text).to.include("Failed to create branch");
    });
  });

  describe("create action", () => {
    beforeEach(() => {
      // Setup common successful git responses
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
    });

    it("should successfully create a new branch", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create",
        base: "develop"
      });

      expect(result.content[0].text).to.include("✅ Successfully created branch");
      expect(result.content[0].text).to.include("feature-branch");
      expect(result.content[0].text).to.include("Created and checked out new branch");
    });

    it("should handle branch already exists error", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("feature-branch");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create"
      });

      expect(result.content[0].text).to.include("❌ Failed to create branch");
      expect(result.content[0].text).to.include("already exists locally");
    });

    it("should handle uncommitted changes with stashing", async () => {
      execSyncStub.withArgs("git status --porcelain").returns("M file.txt");
      execSyncStub.withArgs("git stash push -m 'Auto-stash by prepare_branch'").returns("");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");
      execSyncStub.withArgs("git branch --show-current").onSecondCall().returns("feature-branch");
      execSyncStub.withArgs("git stash pop").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create",
        stashChanges: true
      });

      expect(result.content[0].text).to.include("Stashed uncommitted changes");
      expect(result.content[0].text).to.include("Restored previously stashed changes");
    });

    it("should push to remote when requested", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin feature-branch").returns("");
      execSyncStub.withArgs("git push -u origin feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create",
        pushToRemote: true
      });

      expect(result.content[0].text).to.include("Pushed branch to remote and set up tracking");
    });
  });

  describe("checkout action", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
    });

    it("should checkout existing local branch", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("feature-branch");
      execSyncStub.withArgs("git checkout feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "checkout"
      });

      expect(result.content[0].text).to.include("✅ Successfully checked out branch");
      expect(result.content[0].text).to.include("Checked out existing local branch");
    });

    it("should checkout remote branch and create local tracking", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin feature-branch").returns("abc123 refs/heads/feature-branch");
      execSyncStub.withArgs("git checkout -b feature-branch origin/feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "checkout"
      });

      expect(result.content[0].text).to.include("Created local tracking branch from remote");
    });

    it("should handle branch not found error", async () => {
      execSyncStub.withArgs("git branch --list \"nonexistent-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin nonexistent-branch").returns("");

      const result = await prepareBranch({
        branch: "nonexistent-branch",
        action: "checkout"
      });

      expect(result.content[0].text).to.include("❌ Failed to checkout branch");
      expect(result.content[0].text).to.include("does not exist locally or on remote");
    });

    it("should sync with base branch after checkout", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("feature-branch");
      execSyncStub.withArgs("git checkout feature-branch").returns("");
      execSyncStub.withArgs("git fetch origin develop").returns("");
      execSyncStub.withArgs("git rebase origin/develop").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "checkout",
        base: "develop",
        syncStrategy: "rebase"
      });

      expect(result.content[0].text).to.include("Rebased feature-branch onto origin/develop");
    });
  });

  describe("sync action", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
    });

    it("should sync current branch with base using rebase", async () => {
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git fetch origin develop").returns("");
      execSyncStub.withArgs("git rebase origin/develop").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "sync",
        base: "develop",
        syncStrategy: "rebase"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Rebased feature-branch onto origin/develop");
    });

    it("should sync current branch with base using merge", async () => {
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git fetch origin develop").returns("");
      execSyncStub.withArgs("git merge origin/develop").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "sync",
        base: "develop",
        syncStrategy: "merge"
      });

      expect(result.content[0].text).to.include("Merged origin/develop into feature-branch");
    });

    it("should checkout target branch if not current", async () => {
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("feature-branch");
      execSyncStub.withArgs("git checkout feature-branch").returns("");
      execSyncStub.withArgs("git fetch origin develop").returns("");
      execSyncStub.withArgs("git rebase origin/develop").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "sync",
        base: "develop"
      });

      expect(result.content[0].text).to.include("Checked out branch: feature-branch");
    });

    it("should handle rebase conflicts", async () => {
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git fetch origin develop").returns("");

      const conflictError: any = new Error("rebase conflict");
      conflictError.stderr = "CONFLICT: Merge conflict in file.txt";
      execSyncStub.withArgs("git rebase origin/develop").throws(conflictError);

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "sync",
        base: "develop",
        syncStrategy: "rebase"
      });

      expect(result.content[0].text).to.include("⚠️");
      expect(result.content[0].text).to.include("Rebase conflicts detected");
      expect(result.content[0].text).to.include("conflicts need manual resolution");
    });

    it("should handle merge conflicts", async () => {
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git fetch origin develop").returns("");

      const conflictError: any = new Error("merge conflict");
      conflictError.stderr = "CONFLICT: Merge conflict in file.txt";
      execSyncStub.withArgs("git merge origin/develop").throws(conflictError);

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "sync",
        base: "develop",
        syncStrategy: "merge"
      });

      expect(result.content[0].text).to.include("⚠️");
      expect(result.content[0].text).to.include("Merge conflicts detected");
      expect(result.content[0].text).to.include("conflicts need manual resolution");
    });

    it("should handle branch not found for sync", async () => {
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git branch --list \"nonexistent-branch\"").returns("");

      const result = await prepareBranch({
        branch: "nonexistent-branch",
        action: "sync"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync branch");
      expect(result.content[0].text).to.include("does not exist locally");
    });
  });

  describe("stash handling", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git fetch origin").returns("");
    });

    it("should not stash when stashChanges is false", async () => {
      execSyncStub.withArgs("git status --porcelain").returns("M file.txt");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create",
        stashChanges: false
      });

      // Check that the stash command was not called by examining all calls
      const allCalls = execSyncStub.getCalls();
      const stashCalls = allCalls.filter(call =>
        call.args[0] && typeof call.args[0] === "string" && call.args[0].includes("git stash push")
      );
      expect(stashCalls).to.have.length(0);
      expect(result.content[0].text).to.not.include("Stashed");
    });

    it("should handle stash failures gracefully", async () => {
      execSyncStub.withArgs("git status --porcelain").returns("M file.txt");
      execSyncStub.withArgs("git stash push -m 'Auto-stash by prepare_branch'").throws(new Error("stash failed"));
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create",
        stashChanges: true
      });

      expect(result.content[0].text).to.include("⚠️");
      expect(result.content[0].text).to.include("Failed to stash changes");
    });

    it("should handle stash pop failures", async () => {
      execSyncStub.withArgs("git status --porcelain").returns("M file.txt");
      execSyncStub.withArgs("git stash push -m 'Auto-stash by prepare_branch'").returns("");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");
      execSyncStub.withArgs("git branch --show-current").onSecondCall().returns("feature-branch");
      execSyncStub.withArgs("git stash pop").throws(new Error("pop failed"));

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create",
        stashChanges: true
      });

      expect(result.content[0].text).to.include("⚠️");
      expect(result.content[0].text).to.include("Failed to restore stashed changes");
      expect(result.content[0].text).to.include("remain in stash");
    });
  });

  describe("remote push handling", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
    });

    it("should push to existing remote branch", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("feature-branch");
      execSyncStub.withArgs("git checkout feature-branch").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin feature-branch").returns("abc123 refs/heads/feature-branch");
      execSyncStub.withArgs("git push origin feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "checkout",
        pushToRemote: true
      });

      expect(result.content[0].text).to.include("Pushed changes to remote branch");
    });

    it("should handle push failures", async () => {
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("feature-branch");
      execSyncStub.withArgs("git checkout feature-branch").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin feature-branch").returns("");
      execSyncStub.withArgs("git push -u origin feature-branch").throws(new Error("push failed"));

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "checkout",
        pushToRemote: true
      });

      expect(result.content[0].text).to.include("⚠️");
      expect(result.content[0].text).to.include("Failed to push to remote");
    });
  });

  describe("default parameter handling", () => {
    it("should use default base branch", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("");
      execSyncStub.withArgs("git ls-remote --heads origin develop").returns("abc123 refs/heads/develop");
      execSyncStub.withArgs("git checkout develop").returns("");
      execSyncStub.withArgs("git pull origin develop").returns("");
      execSyncStub.withArgs("git checkout -b feature-branch").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "create"
      });

      expect(result.content[0].text).to.include("✅ Successfully created branch");
      // Verify that git checkout develop was called by examining all calls
      const allCalls = execSyncStub.getCalls();
      const checkoutDevelopCalls = allCalls.filter(call =>
        call.args[0] === "git checkout develop"
      );
      expect(checkoutDevelopCalls).to.have.length(1);
    });

    it("should use default sync strategy", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns("");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin").returns("");
      execSyncStub.withArgs("git fetch origin develop").returns("");
      execSyncStub.withArgs("git rebase origin/develop").returns("");

      const result = await prepareBranch({
        branch: "feature-branch",
        action: "sync",
        base: "develop"
      });

      expect(result.content[0].text).to.include("Rebased feature-branch onto origin/develop");
      // Verify that git rebase was called (default strategy) by examining all calls
      const allCalls = execSyncStub.getCalls();
      const rebaseCalls = allCalls.filter(call =>
        call.args[0] === "git rebase origin/develop"
      );
      expect(rebaseCalls).to.have.length(1);
    });
  });
});
