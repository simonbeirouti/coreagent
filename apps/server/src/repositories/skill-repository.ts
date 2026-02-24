import type {
  AdvisoryFeedPage,
  SkillAdvisory,
  SkillDetails,
  SkillSummary,
  SkillVersion
} from "../domain/skill.js";

export interface SkillRepository {
  listSkills(query?: string, options?: { trustedOnly?: boolean }): Promise<SkillSummary[]>;
  getSkill(skillId: string): Promise<SkillDetails | null>;
  getSkillVersion(skillId: string, version: string): Promise<SkillVersion | null>;
  listAdvisories(): Promise<SkillAdvisory[]>;
  listAdvisoryFeed(options?: { cursor?: string; limit?: number }): Promise<AdvisoryFeedPage>;
}

const SKILLS: SkillDetails[] = [
  {
    skillId: "coreagent.repo.search",
    name: "Repository Search",
    description: "Search codebases with indexed metadata and scoped filters.",
    latestVersion: "0.1.0",
    risk: "low",
    versions: [
      {
        version: "0.1.0",
        digest: "sha256:skill-repo-search-010",
        signature: "sig:stub-repo-search-010"
      }
    ]
  }
];

const ADVISORIES: SkillAdvisory[] = [];

export class InMemorySkillRepository implements SkillRepository {
  async listSkills(query?: string, options?: { trustedOnly?: boolean }): Promise<SkillSummary[]> {
    const filtered = query
      ? SKILLS.filter((skill) => {
          const lowerQuery = query.toLowerCase();
          return (
            skill.skillId.toLowerCase().includes(lowerQuery) ||
            skill.name.toLowerCase().includes(lowerQuery) ||
            skill.description.toLowerCase().includes(lowerQuery)
          );
        })
      : SKILLS;

    const mapped = filtered.map((skill) => ({
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
      latestVersion: skill.latestVersion,
      risk: skill.risk,
      trusted: false
    }));
    if (options?.trustedOnly) {
      return mapped.filter((skill) => skill.trusted);
    }
    return mapped;
  }

  async getSkill(skillId: string): Promise<SkillDetails | null> {
    return SKILLS.find((skill) => skill.skillId === skillId) ?? null;
  }

  async getSkillVersion(skillId: string, version: string): Promise<SkillVersion | null> {
    const skill = await this.getSkill(skillId);
    if (!skill) {
      return null;
    }

    return skill.versions.find((item) => item.version === version) ?? null;
  }

  async listAdvisories(): Promise<SkillAdvisory[]> {
    return ADVISORIES;
  }

  async listAdvisoryFeed(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<AdvisoryFeedPage> {
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
    const cursor = options?.cursor;
    const filtered = cursor
      ? ADVISORIES.filter((advisory) => advisory.publishedAt > cursor)
      : ADVISORIES;
    const page = filtered.slice(0, limit);
    const nextCursor = page.length > 0 ? page[page.length - 1]?.publishedAt ?? null : null;
    return {
      advisories: page.map((advisory) => ({
        ...advisory,
        sequenceCursor: advisory.publishedAt,
        forceDisable: advisory.advisoryType === "revocation"
      })),
      nextCursor,
      hasMore: filtered.length > limit
    };
  }
}
