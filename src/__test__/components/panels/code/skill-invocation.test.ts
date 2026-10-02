import { parseSkillInvocations } from "@/components/panels/code/components/AgentHarnessPanel/skill-invocation";

describe("skill composer invocations", () => {
  it("selects a known Pi-style skill command and leaves its request text", () => {
    expect(parseSkillInvocations("/skill:skill-authoring Draft a release skill", ["skill-authoring"])).toEqual({
      prompt: "Draft a release skill",
      selectedSkillIds: ["skill-authoring"],
    });
  });

  it("keeps unknown commands in the prompt", () => {
    expect(parseSkillInvocations("/skill:not-installed Draft it", ["skill-authoring"])).toEqual({
      prompt: "/skill:not-installed Draft it",
      selectedSkillIds: [],
    });
  });

  it("uses a safe request when a selected skill has no arguments", () => {
    expect(parseSkillInvocations("/skill:skill-authoring", ["skill-authoring"])).toEqual({
      prompt: "Use the selected skill.",
      selectedSkillIds: ["skill-authoring"],
    });
  });

  it("treats an @skill reference as an explicit invocation", () => {
    expect(parseSkillInvocations("@skill:skill-authoring Draft it", ["skill-authoring"])).toEqual({
      prompt: "Draft it",
      selectedSkillIds: ["skill-authoring"],
    });
  });
});
