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

  // Added 2026-09-30 from what FY2569 software TORs actually ask for
  // (titles of 2,746 TORs + text of the first extracted ones).
  // Web & mobile
  { slug: "android", name: "Android / Kotlin", category: "frontend" },
  { slug: "ios", name: "iOS / Swift", category: "frontend" },
  { slug: "php", name: "PHP / Laravel", category: "frontend" },
  { slug: "uxui", name: "UX/UI design", category: "frontend" },
  { slug: "wcag", name: "Web accessibility (WCAG)", category: "frontend" },
  { slug: "cms", name: "CMS / WordPress", category: "frontend" },
  // Backend & databases
  { slug: "mysql", name: "MySQL / MariaDB", category: "backend" },
  { slug: "oracleDb", name: "Oracle Database", category: "backend" },
  { slug: "sqlServer", name: "SQL Server", category: "backend" },
  { slug: "microservices", name: "Microservices / API gateway", category: "backend" },
  { slug: "messageQueue", name: "Kafka / message queue", category: "backend" },
  { slug: "erp", name: "ERP / SAP", category: "backend" },
  // AI & data
  { slug: "aiMl", name: "AI / machine learning", category: "data" },
  { slug: "llm", name: "LLM / generative AI", category: "data" },
  { slug: "chatbot", name: "Chatbot", category: "data" },
  { slug: "computerVision", name: "Computer vision / OCR", category: "data" },
  { slug: "dataWarehouse", name: "Data warehouse / ETL", category: "data" },
  { slug: "bigData", name: "Big data", category: "data" },
  { slug: "dashboardBi", name: "Dashboard / BI", category: "data" },
  { slug: "remoteSensing", name: "Satellite / remote sensing", category: "data" },
  // Cloud & infrastructure
  { slug: "govCloud", name: "GDCC / government cloud", category: "infra" },
  { slug: "publicCloud", name: "AWS / Azure / GCP", category: "infra" },
  { slug: "virtualization", name: "VMware / virtualization", category: "infra" },
  { slug: "linux", name: "Linux server", category: "infra" },
  { slug: "backupDr", name: "Backup & disaster recovery", category: "infra" },
  { slug: "network", name: "Network infrastructure", category: "infra" },
  { slug: "monitoring", name: "Monitoring (Grafana / Zabbix)", category: "infra" },
  // Security & standards
  { slug: "iso27001", name: "ISO/IEC 27001", category: "security" },
  { slug: "sso", name: "SSO / OAuth / MFA", category: "security" },
  { slug: "ldap", name: "LDAP / Active Directory", category: "security" },
  { slug: "firewall", name: "Firewall / WAF", category: "security" },
  { slug: "pentest", name: "Penetration testing / VA", category: "security" },
  { slug: "soc", name: "SOC / SIEM", category: "security" },
  { slug: "sslTls", name: "SSL/TLS certificates", category: "security" },
  // Government integration
  { slug: "gdx", name: "GDX / data exchange", category: "government" },
  { slug: "dopa", name: "DOPA / ID-card linkage", category: "government" },
  { slug: "digitalSignature", name: "Digital signature / PKI", category: "government" },
  { slug: "lineApi", name: "LINE OA / LINE API", category: "government" },
  { slug: "ePayment", name: "e-Payment / PromptPay", category: "government" },
  { slug: "openData", name: "Open data / CKAN", category: "government" },
  { slug: "his", name: "Hospital IS (HIS / HL7)", category: "government" },
  { slug: "lms", name: "LMS / e-Learning", category: "government" },
  { slug: "iot", name: "IoT / MQTT", category: "government" },
  { slug: "itil", name: "ITIL / service desk", category: "government" },
] as const;
