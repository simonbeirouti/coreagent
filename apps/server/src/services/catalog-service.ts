import type { SkillRepository } from "../repositories/skill-repository.js";

export class CatalogService {
  public constructor(private readonly repository: SkillRepository) {}

  public listSkills(query?: string, options?: { trustedOnly?: boolean }) {
    return this.repository.listSkills(query, options);
  }

  public getSkill(skillId: string) {
    return this.repository.getSkill(skillId);
  }

  public getSkillVersion(skillId: string, version: string) {
    return this.repository.getSkillVersion(skillId, version);
  }

  public listAdvisories() {
    return this.repository.listAdvisories();
  }

  public listAdvisoryFeed(options?: { cursor?: string; limit?: number }) {
    return this.repository.listAdvisoryFeed(options);
  }
}
