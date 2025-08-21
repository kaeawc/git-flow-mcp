import { expect } from "chai";
import sinon from "sinon";
import syncWork, { schema, metadata } from "../../src/tools/sync-work";

describe("sync-work tool", () => {
  let execSyncStub: sinon.SinonStub;

  beforeEach(() => {
    execSyncStub = sinon.stub();
    sinon.replace(require("child_process"), "execSync", execSyncStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(metadata.name).to.equal("sync_work");
      expect(metadata.description).to.equal("Synchronize branches with intelligent conflict resolution and multiple merge strategies");
      expect(metadata.annotations.title).to.equal("Sync Work");
      expect(metadata.annotations.readOnlyHint).to.be.false;
      expect(metadata.annotations.destructiveHint).to.be.true;
      expect(metadata.annotations.idempotentHint).to.be.false;
    });
  });

  describe("schema validation", () => {
    it("should have correct schema structure", () => {
      expect(schema.targetBranch).to.exist;
      expect(schema.withBranch).to.exist;
      expect(schema.strategy).to.exist;
      expect(schema.autoResolve).to.exist;
      expect(schema.forcePush).to.exist;

      // Test strategy enum values
      const strategyEnum = schema.strategy._def.values;
      expect(strategyEnum).to.include("rebase");
      expect(strategyEnum).to.include("merge");
      expect(strategyEnum).to.include("fast-forward");

      // Test autoResolve enum values - check if it's optional first
      if (schema.autoResolve._def.innerType) {
        // It's an optional field, get the inner type
        const autoResolveEnum = schema.autoResolve._def.innerType._def.values;
        expect(autoResolveEnum).to.include("ours");
        expect(autoResolveEnum).to.include("theirs");
        expect(autoResolveEnum).to.include("smart");
      } else if (schema.autoResolve._def.values) {
        // It's a direct enum
        const autoResolveEnum = schema.autoResolve._def.values;
        expect(autoResolveEnum).to.include("ours");
        expect(autoResolveEnum).to.include("theirs");
        expect(autoResolveEnum).to.include("smart");
      }
    });
  });

  describe("error handling", () => {
    it("should fail if not in a git repository", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").throws(new Error("Not a git repository"));

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work: Not in a git repository");
    });

    it("should fail if target branch doesn't exist", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"nonexistent-branch\"").returns("");

      const result = await syncWork({
        targetBranch: "nonexistent-branch",
        withBranch: "main",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work");
      expect(result.content[0].text).to.include("Target branch \"nonexistent-branch\" does not exist locally");
    });

    it("should fail if source branch doesn't exist on remote", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin nonexistent-branch").returns("");

      const result = await syncWork({
        targetBranch: "feature-branch",
        withBranch: "nonexistent-branch",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work");
      expect(result.content[0].text).to.include("Source branch \"nonexistent-branch\" does not exist on remote");
    });

    it("should fail if working directory is not clean when switching branches", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("current-branch");
      execSyncStub.withArgs("git branch --list \"target-branch\"").returns("  target-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("M modified-file.txt");

      const result = await syncWork({
        targetBranch: "target-branch",
        withBranch: "main",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work");
      expect(result.content[0].text).to.include("Working directory not clean");
    });
  });

  describe("successful sync operations", () => {
    beforeEach(() => {
      // Setup common successful git operations
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch").returns("0\t2");
    });

    it("should successfully perform fast-forward merge", async () => {
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("**Strategy used:** fast-forward");
      expect(result.content[0].text).to.include("Fast-forwarded feature-branch to origin/main");
    });

    it("should successfully perform merge", async () => {
      execSyncStub.withArgs("git merge --no-ff origin/main -m \"Merge origin/main into feature-branch\"").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("**Strategy used:** merge");
      expect(result.content[0].text).to.include("Merged origin/main into feature-branch");
    });

    it("should successfully perform rebase", async () => {
      execSyncStub.withArgs("git rebase origin/main").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "rebase"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("**Strategy used:** rebase");
      expect(result.content[0].text).to.include("Rebased feature-branch onto origin/main");
    });

    it("should handle force push when requested", async () => {
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");
      execSyncStub.withArgs("git push --force-with-lease origin feature-branch").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward",
        forcePush: true
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Force pushed changes to origin/feature-branch");
    });

    it("should handle force push failure gracefully", async () => {
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");
      execSyncStub.withArgs("git push --force-with-lease origin feature-branch").throws(new Error("Push rejected"));

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward",
        forcePush: true
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("⚠️ Failed to force push: Push rejected");
    });
  });

  describe("branch switching", () => {
    it("should switch to target branch when not on it", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("current-branch");
      execSyncStub.withArgs("git branch --list \"target-branch\"").returns("  target-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git checkout target-branch").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...target-branch").returns("0\t2");
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");

      const result = await syncWork({
        targetBranch: "target-branch",
        withBranch: "main",
        strategy: "fast-forward"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Checked out target branch: target-branch");
    });
  });

  describe("conflict handling", () => {
    beforeEach(() => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch").returns("0\t2");
    });

    it("should handle merge conflicts without auto-resolve", async () => {
      const mergeError = new Error("Merge conflict");
      mergeError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git merge --no-ff origin/main -m \"Merge origin/main into feature-branch\"").throws(mergeError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt\nfile2.txt");

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("⚠️ Sync conflicts detected");
      expect(result.content[0].text).to.include("• file1.txt");
      expect(result.content[0].text).to.include("• file2.txt");
      expect(result.content[0].text).to.include("Resolve conflicts in the listed files");
    });

    it("should handle rebase conflicts without auto-resolve", async () => {
      const rebaseError = new Error("Rebase conflict");
      rebaseError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git rebase origin/main").throws(rebaseError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt");

      const result = await syncWork({
        withBranch: "main",
        strategy: "rebase"
      });

      expect(result.content[0].text).to.include("⚠️ Sync conflicts detected");
      expect(result.content[0].text).to.include("• file1.txt");
      expect(result.content[0].text).to.include("git rebase --continue");
    });

    it("should auto-resolve conflicts with 'ours' strategy", async () => {
      const mergeError = new Error("Merge conflict");
      mergeError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git merge --no-ff origin/main -m \"Merge origin/main into feature-branch\"").throws(mergeError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt");
      execSyncStub.withArgs("git checkout --ours \"file1.txt\"").returns("");
      execSyncStub.withArgs("git add \"file1.txt\"").returns("");
      execSyncStub.withArgs("git commit --no-edit").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge",
        autoResolve: "ours"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Auto-resolved conflict in file1.txt using 'ours' strategy");
      expect(result.content[0].text).to.include("**Resolved conflicts:**");
    });

    it("should auto-resolve conflicts with 'theirs' strategy", async () => {
      const mergeError = new Error("Merge conflict");
      mergeError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git merge --no-ff origin/main -m \"Merge origin/main into feature-branch\"").throws(mergeError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt");
      execSyncStub.withArgs("git checkout --theirs \"file1.txt\"").returns("");
      execSyncStub.withArgs("git add \"file1.txt\"").returns("");
      execSyncStub.withArgs("git commit --no-edit").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge",
        autoResolve: "theirs"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Auto-resolved conflict in file1.txt using 'theirs' strategy");
    });

    it("should auto-resolve conflicts with 'smart' strategy", async () => {
      const mergeError = new Error("Merge conflict");
      mergeError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git merge --no-ff origin/main -m \"Merge origin/main into feature-branch\"").throws(mergeError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt");
      execSyncStub.withArgs("git checkout --theirs \"file1.txt\"").returns("");
      execSyncStub.withArgs("git add \"file1.txt\"").returns("");
      execSyncStub.withArgs("git commit --no-edit").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge",
        autoResolve: "smart"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Auto-resolved conflict in file1.txt using 'smart' strategy");
    });

    it("should handle auto-resolve failures gracefully", async () => {
      const mergeError = new Error("Merge conflict");
      mergeError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git merge --no-ff origin/main -m \"Merge origin/main into feature-branch\"").throws(mergeError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt");
      execSyncStub.withArgs("git checkout --ours \"file1.txt\"").throws(new Error("Failed to resolve"));
      execSyncStub.withArgs("git add \"file1.txt\"").returns(""); // This should not be called but add it just in case

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge",
        autoResolve: "ours"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("⚠️ Failed to auto-resolve conflict in file1.txt: Failed to resolve");
      expect(result.content[0].text).to.include("**Resolved conflicts:**");
    });

    it("should continue rebase after conflict resolution", async () => {
      const rebaseError = new Error("Rebase conflict");
      rebaseError.stderr = "CONFLICT (content): Merge conflict in file1.txt";
      execSyncStub.withArgs("git rebase origin/main").throws(rebaseError);
      execSyncStub.withArgs("git diff --name-only --diff-filter=U").returns("file1.txt");
      execSyncStub.withArgs("git checkout --ours \"file1.txt\"").returns("");
      execSyncStub.withArgs("git add \"file1.txt\"").returns("");
      execSyncStub.withArgs("git rebase --continue").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "rebase",
        autoResolve: "ours"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Continued rebase after conflict resolution");
    });
  });

  describe("edge cases", () => {
    it("should handle detached HEAD state", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "merge"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work");
      expect(result.content[0].text).to.include("Cannot determine target branch (detached HEAD and no branch specified)");
    });

    it("should handle fast-forward not possible", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch").returns("0\t2");

      const fastForwardError = new Error("Fast-forward not possible");
      fastForwardError.stderr = "fatal: Not possible to fast-forward, aborting.";
      execSyncStub.withArgs("git merge --ff-only origin/main").throws(fastForwardError);

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward"
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work");
      expect(result.content[0].text).to.include("Sync failed:");
    });

    it("should use current branch when targetBranch is not specified", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch").returns("0\t2");
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward"
      });

      expect(result.content[0].text).to.include("✅ Successfully synced branch");
      expect(result.content[0].text).to.include("Target branch: feature-branch");
    });

    it("should handle invalid strategy", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch").returns("0\t2");

      // This should be caught by the schema validation, but let's test the internal logic
      const result = await syncWork({
        withBranch: "main",
        strategy: "invalid" as any
      });

      expect(result.content[0].text).to.include("❌ Failed to sync work");
      expect(result.content[0].text).to.include("Unknown strategy: invalid");
    });
  });

  describe("ahead/behind information", () => {
    it("should show correct ahead/behind information", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch")
        .onFirstCall().returns("2\t3")
        .onSecondCall().returns("0\t3");
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward"
      });

      expect(result.content[0].text).to.include("Before sync: 3 ahead, 2 behind origin/main");
      expect(result.content[0].text).to.include("After sync: 3 ahead, 0 behind origin/main");
    });

    it("should handle malformed ahead/behind output gracefully", async () => {
      execSyncStub.withArgs("git rev-parse --git-dir").returns(".git");
      execSyncStub.withArgs("git branch --show-current").returns("feature-branch");
      execSyncStub.withArgs("git branch --list \"feature-branch\"").returns("  feature-branch");
      execSyncStub.withArgs("git ls-remote --heads origin main").returns("abc123\trefs/heads/main");
      execSyncStub.withArgs("git status --porcelain").returns("");
      execSyncStub.withArgs("git fetch origin main").returns("");
      execSyncStub.withArgs("git rev-list --left-right --count origin/main...feature-branch").returns("invalid");
      execSyncStub.withArgs("git merge --ff-only origin/main").returns("");

      const result = await syncWork({
        withBranch: "main",
        strategy: "fast-forward"
      });

      expect(result.content[0].text).to.include("Before sync: undefined ahead, 0 behind origin/main");
      expect(result.content[0].text).to.include("After sync: undefined ahead, 0 behind origin/main");
    });
  });
});
