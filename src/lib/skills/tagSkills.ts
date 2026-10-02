import { SKILL_VOCABULARY } from "../../modules/techstack/techstack.vocabulary.ts";

// Which of the profile vocabulary's skills does a TOR ask for?
//
// Pure (§4.5): text in, tags out, no I/O — same reasoning as
// lib/classify/software.ts. The matching is keyword-only on purpose: it is
// deterministic, runs without a model, and every tag carries the quote that
// produced it, so a wrong tag is a one-line alias fix rather than a prompt
// investigation. An LLM pass can add tags later; it writes `source: "llm"`
// and never overwrites these.

export type SkillSlug = (typeof SKILL_VOCABULARY)[number]["slug"];

/** Bump when aliases or matching change, so stale tags are findable. */
export const SKILL_TAGGER_VERSION = 3;

/**
 * A plain string is matched case-insensitively. When it is ASCII it must also
 * stand as its own token — "GIS" must not fire inside "LOGISTICS". Thai has no
 * spaces between words, so Thai aliases are plain substrings.
 *
 * A RegExp is used as given, for the few names that are also English words
 * ("React", "Angular") or that another skill's name contains.
 */
type Alias = string | RegExp;

const TOKEN_EDGE_BEFORE = "(?<![A-Za-z0-9])";
const TOKEN_EDGE_AFTER = "(?![A-Za-z0-9])";

export const SKILL_ALIASES: Record<SkillSlug, Alias[]> = {
  // Case-sensitive: "react" is an English verb. Not followed by "Native", which
  // is its own skill below.
  react: [/(?<![A-Za-z0-9])React(?:\.?js)?(?!\s*Native)(?![A-Za-z0-9])/],
  vue: ["Vue.js", "VueJS", /(?<![A-Za-z0-9])Vue(?![A-Za-z0-9])/],
  angular: [/(?<![A-Za-z0-9])Angular(?:JS)?(?![A-Za-z0-9])/],
  flutter: ["Flutter"],
  reactNative: ["React Native"],

  nodejs: ["Node.js", "NodeJS", "Node JS"],
  postgresql: ["PostgreSQL", "Postgres"],
  mongodb: ["MongoDB", "Mongo DB"],
  dotnet: [".NET", "ASP.NET", "C#"],
  javaSpring: ["Java", "Spring Boot", "Spring Framework"],
  python: ["Python", "Django", "Flask", "FastAPI"],
  timescaledb: ["TimescaleDB"],
  docker: ["Docker", "Kubernetes"],
  powerBi: ["Power BI", "PowerBI"],
  restApi: ["REST API", "RESTful", "Web Service", "Web API"],

  // Case-sensitive, and not after a voltage class: in power tenders "HV GIS"
  // is gas-insulated switchgear, not mapping (MEA substation buys, 2026-09-30).
  gisQgis: [
    /(?<![A-Za-z0-9])(?<!(?:HV|MV|LV|kV)\s+(?:Containerized\s+)?)GIS(?![A-Za-z0-9])/,
    "QGIS",
    "ArcGIS",
    "ระบบสารสนเทศภูมิศาสตร์",
  ],
  thaiEDocument: ["e-Document", "e-Saraban", "สารบรรณอิเล็กทรอนิกส์"],
  thaiD: ["ThaiD"],
  // Integration only. Every Thai tender says bids go "ในระบบ e-GP" — measured
  // on 74 of 76 extracted TORs — so the bare name says nothing about the work.
  egpApi: [/e-?GP\s*API/i, /เชื่อม(?:ต่อ|โยง)[^\n]{0,60}e-?GP/i],
  pdpa: ["PDPA", "คุ้มครองข้อมูลส่วนบุคคล"],

  // ── Added 2026-09-30 (vocabulary v2). Short acronyms are case-sensitive
  // regexes: "AI", "HIS", "SAP", "SSO" are also ordinary letters in English.
  android: ["Android", "Kotlin"],
  ios: [/(?<![A-Za-z0-9])iOS(?![A-Za-z0-9])/, /(?<![A-Za-z0-9])Swift(?![A-Za-z0-9])/],
  php: [/(?<![A-Za-z0-9])PHP(?![A-Za-z0-9])/, "Laravel", "CodeIgniter"],
  uxui: ["UX/UI", "UI/UX", "User Experience", "User Interface", "ออกแบบส่วนติดต่อผู้ใช้"],
  wcag: ["WCAG", "Web Accessibility", "การเข้าถึงเว็บ"],
  cms: ["WordPress", "Drupal", "Joomla", /(?<![A-Za-z0-9])CMS(?![A-Za-z0-9])/, "Content Management System"],
  mysql: ["MySQL", "MariaDB"],
  oracleDb: ["Oracle Database", /(?<![A-Za-z0-9])Oracle(?![A-Za-z0-9])/],
  sqlServer: ["SQL Server", "MSSQL", "MS SQL"],
  microservices: ["Microservice", "Microservices", "API Gateway", "ไมโครเซอร์วิส"],
  messageQueue: ["Kafka", "RabbitMQ", "Message Queue"],
  erp: [/(?<![A-Za-z0-9])ERP(?![A-Za-z0-9])/, /(?<![A-Za-z0-9])SAP(?![A-Za-z0-9])/, "Odoo", "ระบบวางแผนทรัพยากรองค์กร"],
  aiMl: ["Machine Learning", "Deep Learning", "ปัญญาประดิษฐ์", /(?<![A-Za-z0-9])AI(?![A-Za-z0-9])/, "TensorFlow", "PyTorch"],
  llm: [/(?<![A-Za-z0-9])LLMs?(?![A-Za-z0-9])/, "Generative AI", "Large Language Model", /(?<![A-Za-z0-9])GPT(?![A-Za-z0-9])/, "RAG"],
  chatbot: ["Chatbot", "Chat Bot", "แชทบอท"],
  computerVision: ["Computer Vision", /(?<![A-Za-z0-9])OCR(?![A-Za-z0-9])/, "Face Recognition", "Image Recognition", "จดจำใบหน้า"],
  dataWarehouse: ["Data Warehouse", "Data Lake", "คลังข้อมูล", /(?<![A-Za-z0-9])ETL(?![A-Za-z0-9])/],
  bigData: ["Big Data", "ข้อมูลขนาดใหญ่", "Hadoop", "Apache Spark"],
  dashboardBi: ["Dashboard", "แดชบอร์ด", "Business Intelligence", "Tableau", "Looker"],
  remoteSensing: ["Remote Sensing", "สำรวจระยะไกล", "ภาพถ่ายดาวเทียม", "ข้อมูลดาวเทียม"],
  govCloud: ["GDCC", "Government Data Center", "คลาวด์กลางภาครัฐ"],
  publicCloud: [/(?<![A-Za-z0-9])AWS(?![A-Za-z0-9])/, "Amazon Web Services", "Azure", "Google Cloud", /(?<![A-Za-z0-9])GCP(?![A-Za-z0-9])/],
  virtualization: ["VMware", "vSphere", "Virtualization", "Hyper-V"],
  linux: ["Linux", "Ubuntu", "Red Hat", "CentOS", "RHEL"],
  backupDr: ["Disaster Recovery", "DR Site", "Backup", "สำรองข้อมูล"],
  network: ["Cisco", "Fortinet", "Switch Layer", "Load Balancer", "ระบบเครือข่าย"],
  monitoring: ["Grafana", "Prometheus", "Zabbix", "Nagios"],
  iso27001: [/ISO\s*\/?\s*(?:IEC\s*)?27001/i],
  sso: ["Single Sign-On", "Single Sign On", /(?<![A-Za-z0-9])SSO(?![A-Za-z0-9])/, "OAuth", "OpenID", "Keycloak", /(?<![A-Za-z0-9])MFA(?![A-Za-z0-9])/, "2FA"],
  ldap: [/(?<![A-Za-z0-9])LDAP(?![A-Za-z0-9])/, "Active Directory"],
  firewall: ["Firewall", /(?<![A-Za-z0-9])WAF(?![A-Za-z0-9])/, "ไฟร์วอลล์"],
  pentest: ["Penetration Test", "Penetration Testing", "Pentest", "Vulnerability Assessment", "ทดสอบเจาะระบบ"],
  soc: [/(?<![A-Za-z0-9])SIEM(?![A-Za-z0-9])/, "Security Operation Center", "Security Operations Center", "ศูนย์ปฏิบัติการเฝ้าระวัง"],
  sslTls: [/(?<![A-Za-z0-9])SSL(?![A-Za-z0-9])/, /(?<![A-Za-z0-9])TLS(?![A-Za-z0-9])/],
  gdx: [/(?<![A-Za-z0-9])GDX(?![A-Za-z0-9])/, "Linkage Center", "แลกเปลี่ยนข้อมูล"],
  dopa: [/(?<![A-Za-z0-9])DOPA(?![A-Za-z0-9])/, "Smart Card Reader", "ทะเบียนราษฎร"],
  digitalSignature: ["Digital Signature", "e-Signature", "ลายมือชื่ออิเล็กทรอนิกส์", /(?<![A-Za-z0-9])PKI(?![A-Za-z0-9])/],
  lineApi: [/(?<![A-Za-z0-9])LINE\s*(?:OA|Official|API|Notify|LIFF|Messaging)(?![A-Za-z0-9])/],
  ePayment: ["PromptPay", "พร้อมเพย์", "Payment Gateway", "e-Payment"],
  openData: ["Open Data", "ข้อมูลเปิด", /(?<![A-Za-z0-9])CKAN(?![A-Za-z0-9])/],
  his: [/(?<![A-Za-z0-9])HIS(?![A-Za-z0-9])/, /(?<![A-Za-z0-9])HL7(?![A-Za-z0-9])/, "FHIR", "ระบบสารสนเทศโรงพยาบาล"],
  lms: [/(?<![A-Za-z0-9])LMS(?![A-Za-z0-9])/, "Moodle", "e-Learning", "E-Learning"],
  iot: [/(?<![A-Za-z0-9])IoT(?![A-Za-z0-9])/, "MQTT", "Internet of Things"],
  itil: [/(?<![A-Za-z0-9])ITIL(?![A-Za-z0-9])/, "Service Desk", "Help Desk"],
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(alias: Alias): RegExp {
  if (alias instanceof RegExp) return alias;
  const body = escapeRegex(alias);
  // ASCII-only aliases get token edges; anything containing Thai does not.
  return /^[\x00-\x7F]+$/.test(alias)
    ? new RegExp(`${TOKEN_EDGE_BEFORE}${body}${TOKEN_EDGE_AFTER}`, "i")
    : new RegExp(body, "i");
}

const COMPILED = (Object.entries(SKILL_ALIASES) as [SkillSlug, Alias[]][]).map(
  ([slug, aliases]) => ({ slug, patterns: aliases.map(compile) }),
);

export type SkillSource = {
  text: string;
  /** Null for text that is not a chunk, e.g. the project name. */
  chunkIndex: number | null;
};

export type SkillTag = {
  slug: SkillSlug;
  source: "keyword";
  /** A verbatim window of the text around the hit, whitespace collapsed. */
  evidence: string;
  chunkIndex: number | null;
};

/** Characters of context kept on each side of a hit. */
const EVIDENCE_RADIUS = 40;

function evidenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EVIDENCE_RADIUS);
  const end = Math.min(text.length, index + length + EVIDENCE_RADIUS);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * One tag per skill, from its first hit in source order — so pass the project
 * name first and chunks in reading order, and the quote is the most prominent
 * mention.
 */
export function tagSkills(sources: SkillSource[]): SkillTag[] {
  const tags: SkillTag[] = [];

  for (const { slug, patterns } of COMPILED) {
    hit: for (const source of sources) {
      for (const pattern of patterns) {
        const match = pattern.exec(source.text);
        if (!match) continue;
        tags.push({
          slug,
          source: "keyword",
          evidence: evidenceAround(source.text, match.index, match[0].length),
          chunkIndex: source.chunkIndex,
        });
        break hit;
      }
    }
  }

  return tags;
}
