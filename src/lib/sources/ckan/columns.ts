// CKAN column names, verified live against resource e4eaa1b4-…-988ee25b898d.
// Isolated here because a Thai string literal buried in a mapping expression
// cannot be checked by eye.

export const COL = {
  projectId: "รหัสโครงการ",
  title: "ชื่อโครงการ",
  projectType: "ชื่อประเภทโครงการ",
  agency: "ชื่อหน่วยงาน",
  department: "ชื่อหน่วยงานย่อย",
  method: "วิธีจัดซื้อฯ",
  methodGroup: "กลุ่มวิธีจัดซื้อฯ",
  announcedAt: "วันที่ประกาศ",
  budget: "งบประมาณ(บาท)",
  referencePrice: "ราคากลาง(บาท)",
  agreedPrice: "ราคาตกลงซื้อ/จ้าง",
  fiscalYear: "ปีงบประมาณ",
  province: "จังหวัด",
  district: "เขต/อำเภอ",
  subdistrict: "แขวง/ตำบล",
  status: "สถานะโครงการ",
  point: "พิกัดของโครงการ",
  lat: "ละติจูดโครงการ",
  lng: "ลองจิจูดโครงการ",
  winnerTaxId: "เลขนิติบุคคล",
  winnerName: "ชื่อผู้ชนะ",
  contractNumber: "เลขที่สัญญา",
  contractSignedAt: "วันที่ลงนามสัญญา",
  contractEndsAt: "วันที่สิ้นสุดสัญญา",
  contractBudget: "งบสัญญา(บาท)",
  contractStatus: "สถานะสัญญา",
  rowId: "_id",
} as const;

// Declared by the API and never populated. Their presence is what shifts every
// row: 29 values zipped against 32 keys. Columns up to and including จังหวัด
// (index 15) are unaffected; everything after lands under the wrong name.
export const PHANTOM_COLUMNS = [
  "จังหวัด(Eng)",
  "เขต/อำเภอ(Eng)",
  "แขวง/ตำบล(Eng)",
] as const;

export const BANGKOK = "กรุงเทพมหานคร";
