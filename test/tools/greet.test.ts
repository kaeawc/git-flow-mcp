import { expect } from "chai";
import greet, { schema, metadata } from "../../src/tools/greet";

describe("greet tool", () => {
  describe("functionality", () => {
    it("should greet a user with a simple name", async () => {
      const result = await greet({ name: "Alice" });

      expect(result.content).to.have.lengthOf(1);
      expect(result.content[0]).to.deep.equal({
        type: "text",
        text: "Hello, Alice!"
      });
    });

    it("should greet a user with a name containing spaces", async () => {
      const result = await greet({ name: "John Doe" });

      expect(result.content).to.have.lengthOf(1);
      expect(result.content[0]).to.deep.equal({
        type: "text",
        text: "Hello, John Doe!"
      });
    });

    it("should handle empty string name", async () => {
      const result = await greet({ name: "" });

      expect(result.content).to.have.lengthOf(1);
      expect(result.content[0]).to.deep.equal({
        type: "text",
        text: "Hello, !"
      });
    });

    it("should handle names with special characters", async () => {
      const result = await greet({ name: "José María" });

      expect(result.content).to.have.lengthOf(1);
      expect(result.content[0]).to.deep.equal({
        type: "text",
        text: "Hello, José María!"
      });
    });
  });

  describe("schema validation", () => {
    it("should have correct schema structure", () => {
      expect(schema.name).to.exist;
      expect(schema.name._def.typeName).to.equal("ZodString");
    });
  });

  describe("metadata", () => {
    it("should have correct metadata", () => {
      expect(metadata.name).to.equal("greet");
      expect(metadata.description).to.equal("Greet the user");
      expect(metadata.annotations.title).to.equal("Greet the user");
      expect(metadata.annotations.readOnlyHint).to.be.true;
      expect(metadata.annotations.destructiveHint).to.be.false;
      expect(metadata.annotations.idempotentHint).to.be.true;
    });
  });
});
