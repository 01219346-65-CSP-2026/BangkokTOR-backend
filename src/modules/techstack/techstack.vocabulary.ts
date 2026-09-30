/**
 * The skills the frontend wizard offers, one row each. `slug` is the frontend's
 * `SkillId` and must stay in step with SKILL_GROUPS in
 * BangkokTOR-frontend/src/lib/skillProfile.ts — a slug missing here is a 400
 * when a user picks it.
 *
 * Seeded at boot by `ensureSkillVocabulary` (techstack.service.ts).
 */
export const SKILL_VOCABULARY = [
  { slug: "react", name: "React", category: "frontend" },
  { slug: "vue", name: "Vue", category: "frontend" },
  { slug: "angular", name: "Angular", category: "frontend" },
  { slug: "flutter", name: "Flutter", category: "frontend" },
  { slug: "reactNative", name: "React Native", category: "frontend" },

  { slug: "nodejs", name: "Node.js", category: "backend" },
  { slug: "postgresql", name: "PostgreSQL", category: "backend" },
  { slug: "mongodb", name: "MongoDB", category: "backend" },
  { slug: "dotnet", name: ".NET", category: "backend" },
  { slug: "javaSpring", name: "Java / Spring", category: "backend" },
  { slug: "python", name: "Python", category: "backend" },
  { slug: "timescaledb", name: "TimescaleDB", category: "backend" },
  { slug: "docker", name: "Docker", category: "backend" },
  { slug: "powerBi", name: "Power BI", category: "backend" },
  { slug: "restApi", name: "REST API", category: "backend" },

  { slug: "gisQgis", name: "GIS / QGIS", category: "government" },
  { slug: "thaiEDocument", name: "Thai e-Document", category: "government" },
  { slug: "thaiD", name: "ThaiD", category: "government" },
  { slug: "egpApi", name: "e-GP API", category: "government" },
  { slug: "pdpa", name: "PDPA", category: "government" },
] as const;
