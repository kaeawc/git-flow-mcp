import { expect } from "chai";
import { schema, metadata } from "../../src/tools/monitor-status";

describe("monitor-status tool", () => {
  describe("schema validation", () => {
    it("should have correct schema structure", () => {
      expect(schema.target).to.exist;
      expect(schema.target._def.typeName).to.equal("ZodEnum");
      expect(schema.target._def.values).to.deep.equal(["pr", "ci", "feedback", "branch", "all"]);

      expect(schema.branch).to.exist;
      expect(schema.branch._def.typeName).to.equal("ZodOptional");

      expect(schema.prNumber).to.exist;
      expect(schema.prNumber._def.typeName).to.equal("ZodOptional");

      expect(schema.includeDetails).to.exist;
      expect(schema.includeDetails._def.typeName).to.equal("ZodOptional");

      expect(schema.since).to.exist;
      expect(schema.since._def.typeName).to.equal("ZodOptional");

      expect(schema.filterUnresolved).to.exist;
      expect(schema.filterUnresolved._def.typeName).to.equal("ZodOptional");
    });
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(metadata.name).to.equal("monitor_status");
      expect(metadata.description).to.equal("Monitor PR/MR status, CI/CD pipelines, and feedback that needs attention across different platforms");
      expect(metadata.annotations.title).to.equal("Monitor Status");
      expect(metadata.annotations.readOnlyHint).to.be.true;
      expect(metadata.annotations.destructiveHint).to.be.false;
      expect(metadata.annotations.idempotentHint).to.be.true;
    });
  });

  describe("basic functionality", () => {
    it("should be importable", () => {
      const monitorStatus = require("../../src/tools/monitor-status").default;
      expect(monitorStatus).to.be.a("function");
    });

    it("should handle basic error case without git directory", async () => {
      const monitorStatus = require("../../src/tools/monitor-status").default;

      // This will naturally fail since we're not in a git directory in test
      const result = await monitorStatus({ target: "pr" });

      expect(result).to.exist;
      expect(result.content).to.exist;
      expect(result.content).to.have.lengthOf(1);
      expect(result.content[0].text).to.contain("❌ Failed to monitor pr");
    });
  });
});
